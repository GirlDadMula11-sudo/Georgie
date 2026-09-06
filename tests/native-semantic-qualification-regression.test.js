import test from "node:test";
import assert from "node:assert/strict";
import { evaluateN2Promotion } from "../src/native-semantic-promotion.js";

const H = "b".repeat(64);
const base = {
  manifest: {
    engine: { name: "llama.cpp", source: "ggml-org/llama.cpp", revision: "abc123", artifactSha256: H },
    model: { source: "sierra/candidate", revision: "r1", file: "candidate.gguf", artifactSha256: H, quantization: "Q5_K_M", contextWindow: 32768 },
    tokenizer: { revision: "r1", files: [{ path: "tokenizer.json", sha256: H }] },
    hardware: { fingerprintSha256: H },
  },
  sealed: { cases: 220, passRate: 0.97, structuredFailOpen: 0 },
  adversarial: { cases: 220, authorityViolations: 0, promptInjectionEscapes: 0 },
  outage: { cases: 60, terminalFailures: 0 },
  stress: {
    requests: 1500,
    forcedCrashRestarts: 25,
    forcedTimeouts: 25,
    corruptionEvents: 0,
    crashRecoveryFailures: 0,
    timeoutRecoveryFailures: 0,
    errorRate: 0.002,
    determinismMismatchRate: 0.005,
    peakRssBytes: 10,
    memoryLimitBytes: 16,
    p95FirstTokenMs: 1500,
    p95TotalMs: 9000,
  },
  shadow: { comparisons: 220, winRate: 0.64, regressionRate: 0.01 },
};

for (const [name, mutate, failedCheck] of [
  ["missing adversarial coverage", (x) => ({ ...x, adversarial: { ...x.adversarial, cases: undefined } }), "adversarialCoverage"],
  ["missing outage coverage", (x) => ({ ...x, outage: { ...x.outage, cases: undefined } }), "providerOutageCoverage"],
  ["missing memory limit", (x) => ({ ...x, stress: { ...x.stress, memoryLimitBytes: undefined } }), "memoryHeadroom"],
  ["excessive deterministic drift", (x) => ({ ...x, stress: { ...x.stress, determinismMismatchRate: 0.02 } }), "determinism"],
  ["insufficient shadow volume", (x) => ({ ...x, shadow: { ...x.shadow, comparisons: 50 } }), "shadowCoverage"],
]) {
  test(`qualification fails closed on ${name}`, () => {
    const result = evaluateN2Promotion(mutate(base));
    assert.equal(result.passed, false);
    assert.equal(result.checks[failedCheck], false);
    assert.equal(result.productionAuthority, "denied");
  });
}
