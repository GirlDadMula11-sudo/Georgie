import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { N2_PINNED_CMAKE } from "./n2-real-host-candidate-matrix.js";

const execFileAsync = promisify(execFile);
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_BUFFER = 2 * 1024 * 1024;

function fail(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  throw error;
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const prefix = `${resolvedRoot}${path.sep}`;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(prefix)) {
    fail("n2_cmake_path_escape", "Pinned CMake path escaped the isolated qualification root");
  }
  return resolvedTarget;
}

export function pinnedCmakeLayout(toolchainRoot) {
  const root = assertInside(toolchainRoot, path.join(toolchainRoot, `cmake-${N2_PINNED_CMAKE.version}`));
  const archive = assertInside(root, path.join(root, N2_PINNED_CMAKE.archive));
  const extractRoot = assertInside(root, path.join(root, "extract"));
  const binary = assertInside(extractRoot, path.join(extractRoot, N2_PINNED_CMAKE.binaryRelativePath));
  return Object.freeze({ root, archive, extractRoot, binary });
}

async function verifiedArchive(layout) {
  try {
    const digest = await sha256File(layout.archive);
    return digest === N2_PINNED_CMAKE.archiveSha256;
  } catch {
    return false;
  }
}

async function downloadArchive(layout) {
  await fs.mkdir(layout.root, { recursive: true, mode: 0o700 });
  const temporary = `${layout.archive}.${process.pid}.partial`;
  await fs.rm(temporary, { force: true });
  try {
    await execFileAsync("/usr/bin/curl", [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry", "3",
      "--retry-all-errors",
      "--proto", "=https",
      "--tlsv1.2",
      "--output", temporary,
      N2_PINNED_CMAKE.downloadUrl,
    ], { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
    const digest = await sha256File(temporary);
    if (digest !== N2_PINNED_CMAKE.archiveSha256) {
      fail("n2_cmake_archive_hash_mismatch", `Pinned CMake archive SHA-256 mismatch: observed ${digest}`);
    }
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, layout.archive);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function extractArchive(layout) {
  await fs.rm(layout.extractRoot, { recursive: true, force: true });
  await fs.mkdir(layout.extractRoot, { recursive: true, mode: 0o700 });
  try {
    await execFileAsync("/usr/bin/tar", ["-xzf", layout.archive, "-C", layout.extractRoot], {
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
  } catch (error) {
    fail("n2_cmake_extract_failed", "Pinned CMake archive extraction failed", error);
  }
}

async function verifyBinary(layout) {
  try {
    const stat = await fs.stat(layout.binary);
    if (!stat.isFile()) fail("n2_cmake_binary_missing", "Pinned CMake binary is not a regular file");
    const { stdout, stderr } = await execFileAsync(layout.binary, ["--version"], { timeout: 15_000, maxBuffer: MAX_BUFFER });
    const versionText = String(stdout || stderr || "").trim().slice(0, 1000);
    if (!versionText.includes(`cmake version ${N2_PINNED_CMAKE.version}`)) {
      fail("n2_cmake_version_mismatch", `Pinned CMake reported unexpected version: ${versionText}`);
    }
    return Object.freeze({
      path: layout.binary,
      version: N2_PINNED_CMAKE.version,
      versionText,
      archiveSha256: N2_PINNED_CMAKE.archiveSha256,
      binarySha256: await sha256File(layout.binary),
      sourceUrl: N2_PINNED_CMAKE.downloadUrl,
      isolated: true,
      systemPackageManagerMutation: false,
    });
  } catch (error) {
    if (error?.code?.startsWith?.("n2_cmake_")) throw error;
    fail("n2_cmake_binary_unavailable", "Pinned CMake binary could not be executed", error);
  }
}

export async function ensurePinnedCmake(toolchainRoot) {
  if (process.platform !== "darwin") fail("n2_cmake_platform_rejected", "Pinned N2 CMake bootstrap is macOS-only");
  const layout = pinnedCmakeLayout(toolchainRoot);
  await fs.mkdir(toolchainRoot, { recursive: true, mode: 0o700 });

  if (!await verifiedArchive(layout)) {
    await fs.rm(layout.archive, { force: true });
    await downloadArchive(layout);
  }

  try {
    return await verifyBinary(layout);
  } catch (error) {
    if (!["n2_cmake_binary_missing", "n2_cmake_binary_unavailable", "n2_cmake_version_mismatch"].includes(error?.code)) throw error;
  }

  await extractArchive(layout);
  return verifyBinary(layout);
}
