import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateN2Qualification } from "../src/native-qualification-orchestrator.js";
import { validateNativeCandidateManifest } from "../src/native-semantic-promotion.js";

const H = "a".repeat(64);
const C = "b".repeat(64);
const hostProfile = {
  hardwareFingerprintSha256: H,
  hardware: {
    platform: "linux",
    arch: "x64",
    memory: { totalBytes: 64 * 1024 * 1024 * 1024 },
    accelerators: { apple: [], nvidia: [{ name: "test-gpu" }] },
  },
};
const candidates = [{
  id: "candidate-a",
  engine: "vllm",
  model: "candidate/model",
  quantization: "fp8",
  contextWindow: 32768,
  maxConcurrentSequences: 4,
  modelBytes: 12 * 1024 * 1024 * 1024,
  runtimeOverheadBytes: 2 * 1024 * 1024 * 1024,
  kvBytesPerTokenPerSequence: 4096,
  extraWorkingSetBytes: 2 * 1024 * 1024 * 1024,
}];
const manifest = {
  engine: { name: "vllm", source: "vllm-project/vllm", revision: "rev-1", artifactSha256: H },
  model: { source: "candidate/model", revision: "model-rev-1", file: "model.safetensors", artifactSha256: H, quantization: "fp8", contextWindow: 32768 },
  tokenizer: { revision: "tok-rev-1", files: [{ path: "tokenizer.json", sha256: H }] },
  hardware: { fingerprintSha256: H },
};
const manifestSha = validateNativeCandidateManifest(manifest).manifestSha256;

function evidence() {
  const binding = { candidateManifestSha256: manifestSha, hostHardwareFingerprintSha256: H };
  return {
    sealed: { ...binding, corpusSha256: C, cases: 250, passRate: 0.98, structuredFailOpen: 0 },
    adversarial: { ...binding, cases: 250, authorityViolations: 0, promptInjectionEscapes: 0 },
    outage: { ...binding, cases: 60, terminalFailures: 0 },
    stress: {
      ...binding,
      requests: 1500,
      forcedCrashRestarts: 25,
      forcedTimeouts: 25,
      corruptionEvents: 0,
      crashRecoveryFailures: 0,
      timeoutRecoveryFailures: 0,
      errorRate: 0.001,
      determinismMismatchRate: 0.001,
      peakRssBytes: 30 * 1024 * 1024 * 1024,
      memoryLimitBytes: 48 * 1024 * 1024 * 1024,
      p95FirstTokenMs: 1200,
      p95TotalMs: 7000,
    },
    shadow: { ...binding, comparisons: 250, winRate: 0.68, regressionRate: 0.01 },
  };
}

test("qualification binds admitted candidate, host, corpus, and evidence before canary eligibility", () => {
  const e = evidence();
  const result = orchestrateN2Qualification({
    hostProfile,
    candidates,
    selectedCandidateId: "candidate-a",
    candidateManifest: manifest,
    corpusSha256: C,
    ...e,
  });
  assert.equal(result.promotion.productionAuthority, "eligible_for_controlled_canary");
  assert.equal(result.nextAction, "controlled_canary_only");
  assert.equal(result.hostHardwareFingerprintSha256, H);
  assert.equal(result.corpusSha256, C);
  assert.match(result.qualificationReceiptSha256, /^[a-f0-9]{64}$/);
});

test("qualification rejects evidence from a different candidate", () => {
  const e = evidence();
  e.adversarial = { ...e.adversarial, candidateManifestSha256: "c".repeat(64) };
  assert.throws(() => orchestrateN2Qualification({
    hostProfile,
    candidates,
    selectedCandidateId: "candidate-a",
    candidateManifest: manifest,
    corpusSha256: C,
    ...e,
  }), (error) => error?.code === "n2_qualification_binding_mismatch");
});

test("qualification rejects sealed evidence from a different corpus", () => {
  const e = evidence();
  e.sealed = { ...e.sealed, corpusSha256: "d".repeat(64) };
  assert.throws(() => orchestrateN2Qualification({
    hostProfile,
    candidates,
    selectedCandidateId: "candidate-a",
    candidateManifest: manifest,
    corpusSha256: C,
    ...e,
  }), (error) => error?.code === "n2_qualification_binding_mismatch");
});
