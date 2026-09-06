import test from "node:test";
import assert from "node:assert/strict";
import { evaluateN2Promotion, validateNativeCandidateManifest } from "../src/native-semantic-promotion.js";

const H = "a".repeat(64);
const manifest = {
  engine: { name: "llama.cpp", source: "ggml-org/llama.cpp", revision: "0123456789abcdef", artifactSha256: H },
  model: { source: "candidate/model", revision: "revision-1", file: "model.gguf", artifactSha256: H, quantization: "Q4_K_M", contextWindow: 32768 },
  tokenizer: { revision: "revision-1", files: [{ path: "tokenizer.json", sha256: H }] },
  hardware: { fingerprintSha256: H },
};

const passingEvidence = {
  manifest,
  sealed: { cases: 250, passRate: 0.98, structuredFailOpen: 0 },
  adversarial: { cases: 250, authorityViolations: 0, promptInjectionEscapes: 0 },
  outage: { cases: 75, terminalFailures: 0 },
  stress: {
    requests: 2500,
    forcedCrashRestarts: 25,
    forcedTimeouts: 25,
    corruptionEvents: 0,
    crashRecoveryFailures: 0,
    timeoutRecoveryFailures: 0,
    errorRate: 0.001,
    determinismMismatchRate: 0.002,
    peakRssBytes: 12 * 1024 ** 3,
    memoryLimitBytes: 16 * 1024 ** 3,
    p95FirstTokenMs: 1200,
    p95TotalMs: 7000,
  },
  shadow: { comparisons: 250, winRate: 0.67, regressionRate: 0.01 },
};

test("candidate manifest requires exact artifact and tokenizer hashes", () => {
  const pinned = validateNativeCandidateManifest(manifest);
  assert.equal(pinned.engine.artifactSha256, H);
  assert.equal(pinned.model.artifactSha256, H);
  assert.equal(pinned.tokenizer.files[0].sha256, H);
  assert.match(pinned.manifestSha256, /^[a-f0-9]{64}$/);
});

test("promotion is denied when any safety gate regresses", () => {
  const result = evaluateN2Promotion({ ...passingEvidence, adversarial: { ...passingEvidence.adversarial, authorityViolations: 1 } });
  assert.equal(result.passed, false);
  assert.equal(result.productionAuthority, "denied");
  assert.equal(result.rollbackTarget, "sierra-native-intelligence-v1");
  assert.equal(result.checks.authority, false);
});

test("promotion is denied when evidence volume is too small", () => {
  const result = evaluateN2Promotion({ ...passingEvidence, stress: { ...passingEvidence.stress, requests: 50 } });
  assert.equal(result.passed, false);
  assert.equal(result.checks.stressCoverage, false);
});

test("promotion is denied when crash or timeout recovery is imperfect", () => {
  const crash = evaluateN2Promotion({ ...passingEvidence, stress: { ...passingEvidence.stress, crashRecoveryFailures: 1 } });
  assert.equal(crash.passed, false);
  assert.equal(crash.checks.crashRecovery, false);

  const timeout = evaluateN2Promotion({ ...passingEvidence, stress: { ...passingEvidence.stress, timeoutRecoveryFailures: 1 } });
  assert.equal(timeout.passed, false);
  assert.equal(timeout.checks.timeoutRecovery, false);
});

test("promotion is denied when memory headroom is unsafe", () => {
  const result = evaluateN2Promotion({
    ...passingEvidence,
    stress: { ...passingEvidence.stress, peakRssBytes: 15 * 1024 ** 3, memoryLimitBytes: 16 * 1024 ** 3 },
  });
  assert.equal(result.passed, false);
  assert.equal(result.checks.memoryHeadroom, false);
});

test("promotion is denied for malformed or missing numeric evidence", () => {
  const result = evaluateN2Promotion({ ...passingEvidence, stress: { ...passingEvidence.stress, p95TotalMs: "not-a-number" } });
  assert.equal(result.passed, false);
  assert.equal(result.checks.totalLatency, false);
});

test("all gates passing yields canary eligibility, never unconditional production authority", () => {
  const result = evaluateN2Promotion(passingEvidence);
  assert.equal(result.passed, true);
  assert.equal(result.productionAuthority, "eligible_for_controlled_canary");
  assert.equal(result.rollbackTarget, "sierra-native-intelligence-v1");
  assert.equal(result.schema, "sierra.native-semantic-promotion-decision.v2");
  assert.ok(result.evidence.memoryUtilization <= 0.85);
});