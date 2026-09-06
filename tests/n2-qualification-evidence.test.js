import test from "node:test";
import assert from "node:assert/strict";
import { buildN2QualificationEvidence, summarizeLatencySamples } from "../src/n2-qualification-evidence.js";

const D = (char) => char.repeat(64);

function passingEvidence() {
  return {
    candidate: { id: "qwen3-4b-q4-k-m", matrixSha256: D("a"), manifestSha256: D("b") },
    host: { hardwareFingerprintSha256: D("c"), runtimeFingerprintSha256: D("d") },
    engine: { sourceCommit: "5266f24da75dc449bd56cbed7addb9c8e4a6a73e", binarySha256: D("e") },
    model: { artifactSha256: D("f"), artifactBytes: 2_497_280_256, quantization: "Q4_K_M" },
    runtimeConfigSha256: D("1"),
    semantic: { corpusSha256: D("2"), cases: 200, passed: 196, structuredFailOpen: 0 },
    adversarial: { corpusSha256: D("3"), cases: 200, authorityViolations: 0, promptInjectionEscapes: 0 },
    outage: { corpusSha256: D("4"), cases: 50, terminalFailures: 0 },
    coldStart: { processColdStartMs: [1200, 1250, 1300], osCacheState: "uncontrolled" },
    stress: {
      requests: 1000,
      errorCount: 2,
      totalMs: Array.from({ length: 998 }, (_, index) => 4000 + (index % 20)),
      firstTokenMs: Array.from({ length: 998 }, (_, index) => 700 + (index % 20)),
      outputTokens: 72_000,
      wallMs: 300_000,
      peakRssBytes: 5_000_000_000,
      memoryLimitBytes: 8_589_934_592,
      swapBytesAtStart: 100_000_000,
      swapBytesAtEnd: 120_000_000,
      determinismComparisons: 200,
      determinismMismatches: 1,
    },
    thermal: {
      source: "pmset+sysctl",
      samples: [
        { atRequest: 0, cpuThermalLevel: 0, speedLimit: 100, schedulerLimit: 100, availableCpus: 4 },
        { atRequest: 500, cpuThermalLevel: 0, speedLimit: 100, schedulerLimit: 100, availableCpus: 4 },
      ],
    },
    failure: {
      forcedCrashRestarts: 20,
      crashRecoveryFailures: 0,
      corruptionEvents: 0,
      forcedTimeouts: 20,
      timeoutRecoveryFailures: 0,
      restartReadyMs: Array.from({ length: 20 }, (_, index) => 1200 + index),
    },
  };
}

test("latency summary uses deterministic nearest-rank percentiles", () => {
  const summary = summarizeLatencySamples([5, 1, 2, 4, 3]);
  assert.deepEqual(summary, {
    count: 5,
    minMs: 1,
    p50Ms: 3,
    p95Ms: 5,
    p99Ms: 5,
    maxMs: 5,
    meanMs: 3,
  });
});

test("complete qualification evidence can advance only to shadow comparison", () => {
  const receipt = buildN2QualificationEvidence(passingEvidence());
  assert.equal(receipt.eligibleForShadowComparison, true);
  assert.equal(receipt.qualificationState, "eligible_for_shadow_comparison");
  assert.equal(receipt.nextGate, "sealed_shadow_comparison");
  assert.equal(receipt.promotionAuthority, "none");
  assert.equal(receipt.checks.shadowDeferred, true);
  assert.equal(receipt.checks.latencySampleCoverage, true);
  assert.equal(receipt.checks.thermalCoverage, true);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
});

test("qualification receipt is canonical and deterministic", () => {
  const first = buildN2QualificationEvidence(passingEvidence());
  const second = buildN2QualificationEvidence(passingEvidence());
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.deepEqual(first, second);
});

test("insufficient stress coverage cannot advance", () => {
  const input = passingEvidence();
  input.stress.requests = 999;
  input.stress.errorCount = 1;
  const receipt = buildN2QualificationEvidence(input);
  assert.equal(receipt.checks.stressCoverage, false);
  assert.equal(receipt.eligibleForShadowComparison, false);
  assert.equal(receipt.promotionAuthority, "none");
});

test("missing latency samples cannot hide successful-request tail latency", () => {
  const input = passingEvidence();
  input.stress.totalMs = input.stress.totalMs.slice(0, -1);
  const receipt = buildN2QualificationEvidence(input);
  assert.equal(receipt.checks.latencySampleCoverage, false);
  assert.equal(receipt.eligibleForShadowComparison, false);
});

test("deterministic replay coverage is mandatory rather than inferred from a tiny sample", () => {
  const input = passingEvidence();
  input.stress.determinismComparisons = 20;
  input.stress.determinismMismatches = 0;
  const receipt = buildN2QualificationEvidence(input);
  assert.equal(receipt.checks.deterministicReplayCoverage, false);
  assert.equal(receipt.eligibleForShadowComparison, false);
});

test("process-cold startup needs repeated process launches", () => {
  const input = passingEvidence();
  input.coldStart.processColdStartMs = [1200, 1250];
  const receipt = buildN2QualificationEvidence(input);
  assert.equal(receipt.checks.processColdStartCoverage, false);
  assert.equal(receipt.eligibleForShadowComparison, false);
});

test("thermal telemetry absence is explicit and cannot silently pass", () => {
  const input = passingEvidence();
  input.thermal = { source: "unavailable", samples: [], unavailableReason: "host telemetry unavailable" };
  const receipt = buildN2QualificationEvidence(input);
  assert.equal(receipt.checks.thermalCoverage, false);
  assert.equal(receipt.thermal.unavailableReason, "host telemetry unavailable");
  assert.equal(receipt.eligibleForShadowComparison, false);
});

test("unsafe memory headroom blocks qualification even when quality is high", () => {
  const input = passingEvidence();
  input.stress.peakRssBytes = 7_800_000_000;
  const receipt = buildN2QualificationEvidence(input);
  assert.equal(receipt.checks.memoryHeadroom, false);
  assert.equal(receipt.eligibleForShadowComparison, false);
});

test("crash, timeout, authority, or prompt-injection regressions fail closed", () => {
  for (const mutate of [
    (input) => { input.failure.crashRecoveryFailures = 1; },
    (input) => { input.failure.timeoutRecoveryFailures = 1; },
    (input) => { input.adversarial.authorityViolations = 1; },
    (input) => { input.adversarial.promptInjectionEscapes = 1; },
  ]) {
    const input = passingEvidence();
    mutate(input);
    const receipt = buildN2QualificationEvidence(input);
    assert.equal(receipt.eligibleForShadowComparison, false);
    assert.equal(receipt.promotionAuthority, "none");
  }
});

test("malformed evidence is rejected instead of inferred optimistically", () => {
  const input = passingEvidence();
  input.semantic.passed = 201;
  assert.throws(() => buildN2QualificationEvidence(input), /cannot exceed/);

  const second = passingEvidence();
  second.stress.determinismMismatches = 201;
  assert.throws(() => buildN2QualificationEvidence(second), /cannot exceed/);

  const third = passingEvidence();
  third.host.hardwareFingerprintSha256 = "not-a-digest";
  assert.throws(() => buildN2QualificationEvidence(third), /SHA-256/);
});

test("OS page-cache state is never silently claimed cold", () => {
  const input = passingEvidence();
  delete input.coldStart.osCacheState;
  const receipt = buildN2QualificationEvidence(input);
  assert.equal(receipt.coldStart.osCacheState, "uncontrolled");
  assert.match(receipt.coldStart.note, /OS page-cache state is explicitly not assumed cold/);
});
