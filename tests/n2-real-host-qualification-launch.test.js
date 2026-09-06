import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildNativeHardwareProfile } from "../src/native-hardware-profile.js";
import { N2_REAL_HOST } from "../src/n2-real-host-candidate-matrix.js";

const ROOT = path.join(os.homedir(), "Library", "Application Support", "Georgie", "N2-Qualification", "v1");
const RECEIPTS = path.join(ROOT, "receipts");
const LOCK = path.join(ROOT, "campaign-launch.lock.json");
const LOG = path.join(ROOT, "campaign.log");

function onMeasuredPrimaryMac() {
  if (process.env.CI === "true") return false;
  try {
    const profile = buildNativeHardwareProfile();
    return profile.hardwareFingerprintSha256 === N2_REAL_HOST.hardwareFingerprintSha256 &&
      profile.hardware?.platform === "darwin" && profile.hardware?.arch === "x64" &&
      process.cwd() === "/Users/mac/Georgie";
  } catch { return false; }
}

test("real-host N2 qualification launches exactly once on the measured primary Mac", async (t) => {
  if (!onMeasuredPrimaryMac()) return t.skip("qualification launcher is inert away from measured primary-mac");

  await fsp.mkdir(RECEIPTS, { recursive: true, mode: 0o700 });
  const completed = (await fsp.readdir(RECEIPTS)).filter((name) => /^campaign-[a-f0-9]{64}\.json$/.test(name));
  if (completed.length) {
    const latest = completed.sort().at(-1);
    const receipt = JSON.parse(await fsp.readFile(path.join(RECEIPTS, latest), "utf8"));
    assert.equal(receipt.promotionAuthority, "none");
    console.log(`N2_QUALIFICATION_STATUS_JSON:${JSON.stringify({ status: "completed", campaignSha256: receipt.campaignSha256, results: receipt.results })}`);
    return;
  }

  let lock;
  try {
    lock = await fsp.open(LOCK, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = JSON.parse(await fsp.readFile(LOCK, "utf8").catch(() => "{}"));
    console.log(`N2_QUALIFICATION_STATUS_JSON:${JSON.stringify({ status: "already_launched", pid: existing.pid || null, launchedAt: existing.launchedAt || null })}`);
    return;
  }

  const logFd = fs.openSync(LOG, "a", 0o600);
  const script = new URL("../scripts/run-n2-real-host-qualification.mjs", import.meta.url);
  const child = spawn(process.execPath, [script.pathname], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, CI: "false" },
  });
  child.unref();
  fs.closeSync(logFd);
  const record = { schema: "sierra.n2-real-host-qualification-launch.v1", pid: child.pid, launchedAt: new Date().toISOString(), hostHardwareFingerprintSha256: N2_REAL_HOST.hardwareFingerprintSha256 };
  await lock.writeFile(JSON.stringify(record, null, 2));
  await lock.close();
  assert.ok(Number.isInteger(child.pid) && child.pid > 1);
  console.log(`N2_QUALIFICATION_STATUS_JSON:${JSON.stringify({ status: "launched", pid: child.pid, launchedAt: record.launchedAt })}`);
});
