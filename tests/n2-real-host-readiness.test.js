import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const SHA256 = /^[a-f0-9]{64}$/;

function run(command, args = []) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

async function sha256File(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function locateExecutable(name) {
  const direct = run("/usr/bin/which", [name]);
  return direct && path.isAbsolute(direct) ? direct : null;
}

async function executableReceipt(name) {
  const file = locateExecutable(name);
  if (!file) return { installed: false, path: null, sha256: null, version: null };
  const hash = await sha256File(file);
  const version = run(file, ["--version"]).slice(0, 500) || null;
  return { installed: true, path: file, sha256: hash, version };
}

test("N2 real-host readiness emits bounded tooling and disk evidence on macOS", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("real N2 host readiness is emitted only on macOS; CI remains a structural gate");
    return;
  }

  const disk = await fs.statfs(os.homedir());
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  const totalBytes = Number(disk.blocks) * Number(disk.bsize);
  assert.ok(Number.isSafeInteger(freeBytes) && freeBytes > 0, "free disk must be measurable");
  assert.ok(Number.isSafeInteger(totalBytes) && totalBytes >= freeBytes, "total disk must be measurable");

  const readiness = {
    schema: "sierra.native-semantic-host-readiness.v1",
    platform: process.platform,
    arch: process.arch,
    disk: { freeBytes, totalBytes },
    tooling: {
      git: { installed: Boolean(run("/usr/bin/git", ["--version"])), version: run("/usr/bin/git", ["--version"]) || null },
      cmake: { installed: Boolean(locateExecutable("cmake")), version: (locateExecutable("cmake") ? run(locateExecutable("cmake"), ["--version"]).split("\n")[0] : "") || null },
      clang: { installed: Boolean(locateExecutable("clang")), version: (locateExecutable("clang") ? run(locateExecutable("clang"), ["--version"]).split("\n")[0] : "") || null },
    },
    llama: {
      cli: await executableReceipt("llama-cli"),
      server: await executableReceipt("llama-server"),
    },
  };

  for (const binary of [readiness.llama.cli, readiness.llama.server]) {
    if (binary.installed) assert.match(String(binary.sha256 || ""), SHA256);
  }

  console.log(`N2_HOST_READINESS_JSON:${JSON.stringify(readiness)}`);
});
