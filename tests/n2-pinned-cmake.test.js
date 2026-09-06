import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { N2_PINNED_CMAKE, n2RealHostMatrixReceipt } from "../src/n2-real-host-candidate-matrix.js";
import { pinnedCmakeLayout } from "../src/n2-pinned-cmake.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

test("N2 pins one exact CMake artifact and does not authorize package-manager mutation", () => {
  assert.equal(N2_PINNED_CMAKE.version, "4.4.2");
  assert.equal(N2_PINNED_CMAKE.platform, "macos10.10-universal");
  assert.match(N2_PINNED_CMAKE.archiveSha256, /^[a-f0-9]{64}$/);
  assert.match(N2_PINNED_CMAKE.downloadUrl, /^https:\/\/github\.com\/Kitware\/CMake\/releases\/download\/v4\.4\.2\//);
  assert.match(N2_PINNED_CMAKE.binaryRelativePath, /CMake\.app\/Contents\/bin\/cmake$/);

  const receipt = n2RealHostMatrixReceipt();
  assert.equal(receipt.buildToolchain.cmake.archiveSha256, N2_PINNED_CMAKE.archiveSha256);
  assert.equal(receipt.policy.systemPackageManagerMutation, false);
  assert.equal(receipt.policy.buildToolBootstrapIsolatedAndHashPinned, true);
  assert.match(receipt.matrixSha256, /^[a-f0-9]{64}$/);
});

test("pinned CMake layout cannot escape the isolated toolchain root", () => {
  const root = path.resolve("/tmp/sierra-n2-toolchain-test");
  const layout = pinnedCmakeLayout(root);
  for (const value of Object.values(layout)) {
    assert.ok(path.resolve(value).startsWith(`${root}${path.sep}`));
  }
  assert.doesNotMatch(JSON.stringify(layout), /\/usr\/local|\/opt\/homebrew/);
});

test("real-host runner consumes only the isolated pinned CMake helper", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts", "run-n2-real-host-qualification.mjs"), "utf8");
  assert.match(source, /ensurePinnedCmake\(TOOLCHAIN_ROOT\)/);
  assert.match(source, /cmake\.path/);
  assert.match(source, /cmakeArchiveSha256/);
  assert.match(source, /cmakeBinarySha256/);
  assert.match(source, /systemPackageManagerMutation/);
  assert.doesNotMatch(source, /\/usr\/local\/bin\/cmake/);
  assert.doesNotMatch(source, /\/opt\/homebrew\/bin\/cmake/);
});

test("bootstrap implementation verifies the downloaded archive before extraction", () => {
  const source = fs.readFileSync(path.join(ROOT, "src", "n2-pinned-cmake.js"), "utf8");
  const hashCheck = source.indexOf("n2_cmake_archive_hash_mismatch");
  const extraction = source.indexOf("/usr/bin/tar");
  assert.ok(hashCheck >= 0);
  assert.ok(extraction > hashCheck);
  assert.match(source, /--proto", "=https"/);
  assert.match(source, /--tlsv1\.2/);
  assert.match(source, /systemPackageManagerMutation: false/);
});
