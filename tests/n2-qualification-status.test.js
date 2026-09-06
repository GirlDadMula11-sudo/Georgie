import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readN2QualificationStatus, DEFAULT_N2_QUALIFICATION_ROOT } from "../src/n2-qualification-status.js";
import { canonicalJson } from "../src/native-hardware-profile.js";
import { N2_REAL_HOST_CAMPAIGN_GENERATION } from "../src/n2-real-host-candidate-matrix.js";
import crypto from "node:crypto";

const sha = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
const D = (char) => char.repeat(64);

function fakeFs({ files = {}, mtimes = {} } = {}) {
  return {
    async readdir(dir) {
      const prefix = `${dir}/`;
      const names = Object.keys(files).filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length)).filter((name) => !name.includes("/"));
      if (!names.length) { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
      return names;
    },
    async readFile(file) {
      if (!(file in files)) { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
      return files[file];
    },
    async stat(file) {
      if (!(file in files)) { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
      return { mtimeMs: mtimes[file] || 0 };
    },
  };
}

function campaign() {
  const body = {
    schema: "sierra.n2-real-host-qualification-campaign.v1",
    campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION,
    startedAt: "2026-09-06T23:00:00.000Z",
    completedAt: "2026-09-06T23:05:00.000Z",
    hostHardwareFingerprintSha256: D("a"),
    hostRuntimeFingerprintSha256: D("b"),
    matrixSha256: D("c"),
    engineCommit: "5266f24da75dc449bd56cbed7addb9c8e4a6a73e",
    engineBinarySha256: D("d"),
    freeBytesAtStart: 10_000_000_000,
    results: [{
      candidateId: "qwen3-4b-q4-k-m",
      receiptSha256: D("e"),
      receiptFile: "/private/path/that/must/not/escape.json",
      evidence: {
        coldStartMs: 1200,
        restartReadyMs: 1100,
        semanticCases: 6,
        semanticPassed: 6,
        semanticPassRate: 1,
        stressRequests: 60,
        stressErrors: 0,
        stressErrorRate: 0,
        p50TotalMs: 4200,
        p95TotalMs: 5100,
        peakRssBytes: 4_100_000_000,
        postRestartRssBytes: 4_000_000_000,
        thermalSamples: [0, 0, 0],
        forcedCrashRestarts: 1,
        crashRecoverySucceeded: true,
        preCrashPid: 1234,
        rawPrompt: "secret prompt that must not escape",
        rawOutput: "model output that must not escape",
      },
    }],
    promotionAuthority: "none",
    nextGate: "full_sealed_adversarial_outage_stress_shadow_campaign",
  };
  return { ...body, campaignSha256: sha(canonicalJson(body)) };
}

function failure() {
  const body = {
    schema: "sierra.n2-real-host-qualification-failure.v1",
    campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION,
    failedAt: "2026-09-06T23:03:00.000Z",
    hostHardwareFingerprintSha256: D("a"),
    code: "n2_model_hash_mismatch",
    message: "artifact mismatch",
    promotionAuthority: "none",
  };
  return { ...body, failureSha256: sha(canonicalJson(body)) };
}

test("completed campaign projection exposes only bounded aggregate evidence", async () => {
  const payload = campaign();
  const file = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "receipts", `campaign-${payload.campaignSha256}.json`);
  const status = await readN2QualificationStatus({ fsImpl: fakeFs({ files: { [file]: JSON.stringify(payload) }, mtimes: { [file]: 10 } }), root: DEFAULT_N2_QUALIFICATION_ROOT });
  assert.equal(status.status, "completed");
  assert.equal(status.campaignGeneration, N2_REAL_HOST_CAMPAIGN_GENERATION);
  assert.equal(status.promotionAuthority, "none");
  assert.equal(status.candidates[0].candidateId, "qwen3-4b-q4-k-m");
  assert.equal(status.candidates[0].stressRequests, 60);
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /private\/path/);
  assert.doesNotMatch(serialized, /secret prompt/);
  assert.doesNotMatch(serialized, /model output/);
  assert.doesNotMatch(serialized, /preCrashPid/);
  assert.doesNotMatch(serialized, /thermalSamples/);
  assert.match(status.projectionSha256, /^[a-f0-9]{64}$/);
});

test("terminal receipt must match both filename digest and canonical content", async () => {
  const payload = campaign();
  const wrong = D("f");
  const file = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "receipts", `campaign-${wrong}.json`);
  await assert.rejects(() => readN2QualificationStatus({ fsImpl: fakeFs({ files: { [file]: JSON.stringify(payload) } }), root: DEFAULT_N2_QUALIFICATION_ROOT }), /FILENAME_HASH_MISMATCH/);

  const tampered = { ...payload, completedAt: "2026-09-06T23:06:00.000Z" };
  const correctName = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "receipts", `campaign-${payload.campaignSha256}.json`);
  await assert.rejects(() => readN2QualificationStatus({ fsImpl: fakeFs({ files: { [correctName]: JSON.stringify(tampered) } }), root: DEFAULT_N2_QUALIFICATION_ROOT }), /CANONICAL_HASH_MISMATCH/);
});

test("terminal receipt from another generation is rejected", async () => {
  const payload = campaign();
  const body = { ...payload, campaignGeneration: "v1" };
  delete body.campaignSha256;
  const stale = { ...body, campaignSha256: sha(canonicalJson(body)) };
  const file = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "receipts", `campaign-${stale.campaignSha256}.json`);
  await assert.rejects(() => readN2QualificationStatus({ fsImpl: fakeFs({ files: { [file]: JSON.stringify(stale) } }), root: DEFAULT_N2_QUALIFICATION_ROOT }), /GENERATION_REJECTED/);
});

test("failure projection remains non-promoting and bounded", async () => {
  const payload = failure();
  const file = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "receipts", `failure-${payload.failureSha256}.json`);
  const status = await readN2QualificationStatus({ fsImpl: fakeFs({ files: { [file]: JSON.stringify(payload) } }), root: DEFAULT_N2_QUALIFICATION_ROOT });
  assert.equal(status.status, "failed");
  assert.equal(status.campaignGeneration, N2_REAL_HOST_CAMPAIGN_GENERATION);
  assert.equal(status.code, "n2_model_hash_mismatch");
  assert.equal(status.promotionAuthority, "none");
});

test("live lock is running only when the process is independently alive", async () => {
  const lock = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "campaign-launch.lock.json");
  const files = { [lock]: JSON.stringify({ campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION, pid: 4321, launchedAt: "2026-09-06T23:00:00.000Z", hostHardwareFingerprintSha256: D("a") }) };
  const running = await readN2QualificationStatus({ fsImpl: fakeFs({ files }), root: DEFAULT_N2_QUALIFICATION_ROOT, processSignal(pid, signal) { assert.equal(pid, 4321); assert.equal(signal, 0); } });
  assert.equal(running.status, "running");
  assert.equal(running.campaignGeneration, N2_REAL_HOST_CAMPAIGN_GENERATION);

  const stale = await readN2QualificationStatus({ fsImpl: fakeFs({ files }), root: DEFAULT_N2_QUALIFICATION_ROOT, processSignal() { const error = new Error("dead"); error.code = "ESRCH"; throw error; } });
  assert.equal(stale.status, "stale_lock");
});

test("lock presence alone never proves running", async () => {
  const lock = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "campaign-launch.lock.json");
  const files = { [lock]: JSON.stringify({ campaignGeneration: N2_REAL_HOST_CAMPAIGN_GENERATION, pid: null, launchedAt: "2026-09-06T23:00:00.000Z" }) };
  const status = await readN2QualificationStatus({ fsImpl: fakeFs({ files }), root: DEFAULT_N2_QUALIFICATION_ROOT });
  assert.equal(status.status, "stale_lock");
});

test("projection refuses any alternate root", async () => {
  await assert.rejects(() => readN2QualificationStatus({ root: "/tmp/N2-Qualification" }), /ROOT_REJECTED/);
});

test("candidate-only receipts are reported incomplete, never complete", async () => {
  const file = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "receipts", `qwen3-4b-q4-k-m-${D("a")}.json`);
  const status = await readN2QualificationStatus({ fsImpl: fakeFs({ files: { [file]: "{}" } }), root: DEFAULT_N2_QUALIFICATION_ROOT });
  assert.equal(status.status, "incomplete_without_terminal_receipt");
  assert.equal(status.campaignGeneration, N2_REAL_HOST_CAMPAIGN_GENERATION);
  assert.equal(status.candidateReceiptCount, 1);
  assert.equal(status.promotionAuthority, "none");
});

test("no receipts and no lock reports not started", async () => {
  const fsImpl = {
    async readdir() { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
    async readFile() { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
  };
  const status = await readN2QualificationStatus({ fsImpl, root: DEFAULT_N2_QUALIFICATION_ROOT });
  assert.equal(status.status, "not_started");
  assert.equal(status.campaignGeneration, N2_REAL_HOST_CAMPAIGN_GENERATION);
  assert.equal(status.promotionAuthority, "none");
});
