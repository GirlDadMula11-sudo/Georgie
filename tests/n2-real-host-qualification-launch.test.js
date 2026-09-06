import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildNativeHardwareProfile } from "../src/native-hardware-profile.js";
import { N2_REAL_HOST, N2_REAL_HOST_CAMPAIGN_GENERATION } from "../src/n2-real-host-candidate-matrix.js";

const ROOT = path.join(os.homedir(), "Library", "Application Support", "Georgie", "N2-Qualification", N2_REAL_HOST_CAMPAIGN_GENERATION);
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

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function terminalReceiptStatus() {
  const names = await fsp.readdir(RECEIPTS).catch(() => []);
  const completed = names.filter((name) => /^campaign-[a-f0-9]{64}\.json$/.test(name)).sort();
  if (completed.length) {
    const receipt = JSON.parse(await fsp.readFile(path.join(RECEIPTS, completed.at(-1)), "utf8"));
    assert.equal(receipt.promotionAuthority, "none");
    assert.equal(receipt.campaignGeneration, N2_REAL_HOST_CAMPAIGN_GENERATION);
    return { status: "completed", campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION, campaignSha256: receipt.campaignSha256 };
  }
  const failed = names.filter((name) => /^failure-[a-f0-9]{64}\.json$/.test(name)).sort();
  if (failed.length) {
    const receipt = JSON.parse(await fsp.readFile(path.join(RECEIPTS, failed.at(-1)), "utf8"));
    assert.equal(receipt.promotionAuthority, "none");
    assert.equal(receipt.campaignGeneration, N2_REAL_HOST_CAMPAIGN_GENERATION);
    return { status: "failed", campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION, failureSha256: receipt.failureSha256, code: receipt.code };
  }
  return null;
}

// Temporary real-host campaign trigger. It is deliberately inert in CI and on
// every host except the exact measured primary Mac. Each generation owns a
// separate root/lock/receipt namespace, so prior terminal evidence is immutable.
test("real-host N2 qualification launches exactly once on the measured primary Mac", async (t) => {
  if (!onMeasuredPrimaryMac()) return t.skip("qualification launcher is inert away from measured primary-mac");

  await fsp.mkdir(RECEIPTS, { recursive: true, mode: 0o700 });
  const terminal = await terminalReceiptStatus();
  if (terminal) {
    console.log(`N2_QUALIFICATION_STATUS_JSON:${JSON.stringify(terminal)}`);
    return;
  }

  let existing = null;
  try { existing = JSON.parse(await fsp.readFile(LOCK, "utf8")); } catch {}
  if (existing && processIsAlive(Number(existing.pid))) {
    assert.equal(existing.campaignGeneration, N2_REAL_HOST_CAMPAIGN_GENERATION);
    console.log(`N2_QUALIFICATION_STATUS_JSON:${JSON.stringify({ status: "already_launched", campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION, launchedAt: existing.launchedAt || null })}`);
    return;
  }
  if (existing) await fsp.rm(LOCK, { force: true });

  let lock;
  try {
    lock = await fsp.open(LOCK, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const raced = JSON.parse(await fsp.readFile(LOCK, "utf8").catch(() => "{}"));
    console.log(`N2_QUALIFICATION_STATUS_JSON:${JSON.stringify({ status: "already_launched", campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION, launchedAt: raced.launchedAt || null })}`);
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
  const record = {
    schema: "sierra.n2-real-host-qualification-launch.v2",
    campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION,
    pid: child.pid,
    launchedAt: new Date().toISOString(),
    hostHardwareFingerprintSha256: N2_REAL_HOST.hardwareFingerprintSha256,
  };
  await lock.writeFile(JSON.stringify(record, null, 2));
  await lock.close();
  assert.ok(Number.isInteger(child.pid) && child.pid > 1);
  console.log(`N2_QUALIFICATION_STATUS_JSON:${JSON.stringify({ status: "launched", campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION, launchedAt: record.launchedAt })}`);
});
