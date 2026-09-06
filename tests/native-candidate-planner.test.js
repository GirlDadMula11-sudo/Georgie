import test from "node:test";
import assert from "node:assert/strict";
import { planNativeSemanticCandidates } from "../src/native-candidate-planner.js";

const H = "a".repeat(64);

function host(overrides = {}) {
  return {
    schema: "sierra.native-semantic-host-profile.v2",
    hardwareFingerprintSha256: H,
    runtimeFingerprintSha256: "b".repeat(64),
    hardware: {
      schema: "sierra.native-semantic-hardware.v2",
      platform: "darwin",
      arch: "arm64",
      cpu: { model: "Apple M2", logicalCount: 8, apple: { chip: "Apple M2", physicalCores: 8, performanceCores: 4, efficiencyCores: 4 } },
      memory: { totalBytes: 16 * 1024 ** 3 },
      accelerators: { apple: [{ chipset: "Apple M2", vram: "Shared", metal: "Supported" }], nvidia: null },
      ...overrides,
    },
    runtime: { schema: "sierra.native-semantic-runtime-environment.v1", osRelease: "x", nodeVersion: "v22" },
  };
}

function candidate(overrides = {}) {
  return {
    id: "candidate-a",
    engine: "mlx-lm",
    model: "example/model",
    quantization: "4bit",
    contextWindow: 16384,
    maxConcurrentSequences: 2,
    modelBytes: 4 * 1024 ** 3,
    runtimeOverheadBytes: 1024 ** 3,
    kvBytesPerTokenPerSequence: 64 * 1024,
    extraWorkingSetBytes: 512 * 1024 ** 2,
    ...overrides,
  };
}

test("admits a measured candidate only when engine, context, concurrency, and memory fit", () => {
  const result = planNativeSemanticCandidates({
    hostProfile: host(),
    candidates: [candidate()],
    requiredContextWindow: 8192,
    requiredConcurrency: 1,
  });
  assert.deepEqual(result.admittedCandidateIds, ["candidate-a"]);
  assert.equal(result.evaluations[0].admittedForQualification, true);
  assert.match(result.plannerDecisionSha256, /^[a-f0-9]{64}$/);
});

test("rejects memory-unsafe candidates before benchmarking", () => {
  const result = planNativeSemanticCandidates({
    hostProfile: host(),
    candidates: [candidate({ modelBytes: 14 * 1024 ** 3 })],
  });
  assert.equal(result.evaluations[0].admittedForQualification, false);
  assert.equal(result.evaluations[0].checks.memoryCapacity, false);
  assert.ok(result.evaluations[0].reasons.includes("memory_budget_exceeded"));
  assert.equal(result.nextAction, "no_candidate_safe_to_benchmark");
});

test("mlx-lm fails closed away from Apple silicon", () => {
  const profile = host({ platform: "linux", arch: "x64", accelerators: { apple: null, nvidia: [] } });
  const result = planNativeSemanticCandidates({ hostProfile: profile, candidates: [candidate()] });
  assert.equal(result.evaluations[0].checks.engineCompatibility, false);
  assert.ok(result.evaluations[0].reasons.includes("mlx_lm_requires_apple_silicon"));
});

test("vllm candidate requires a Linux NVIDIA host in Sierra planner v1", () => {
  const result = planNativeSemanticCandidates({
    hostProfile: host(),
    candidates: [candidate({ id: "vllm-a", engine: "vllm" })],
  });
  assert.equal(result.evaluations[0].checks.engineCompatibility, false);
  assert.ok(result.evaluations[0].reasons.includes("vllm_candidate_requires_linux_nvidia_host"));
});

test("planner refuses unsafe memory-budget overrides above 80 percent", () => {
  assert.throws(
    () => planNativeSemanticCandidates({ hostProfile: host(), candidates: [candidate()], maxHostMemoryFraction: 0.9 }),
    (error) => error?.code === "n2_planner_invalid",
  );
});

test("incomplete memory evidence is rejected instead of estimated optimistically", () => {
  const broken = candidate();
  delete broken.kvBytesPerTokenPerSequence;
  assert.throws(
    () => planNativeSemanticCandidates({ hostProfile: host(), candidates: [broken] }),
    (error) => error?.code === "n2_candidate_invalid",
  );
});
