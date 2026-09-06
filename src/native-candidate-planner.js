import { createHash } from "node:crypto";
import { canonicalJson } from "./native-hardware-profile.js";

export const N2_CANDIDATE_PLANNER_VERSION = "sierra.native-semantic-candidate-planner.v1";

const ENGINES = new Set(["llama.cpp", "mlx-lm", "vllm", "onnx-runtime-genai"]);
const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_HOST_MEMORY_FRACTION = 0.75;
const MAX_ALLOWED_HOST_MEMORY_FRACTION = 0.80;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function positiveInteger(value, field) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) fail("n2_candidate_invalid", `${field} must be a positive safe integer`);
  return n;
}

function nonNegativeInteger(value, field) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) fail("n2_candidate_invalid", `${field} must be a non-negative safe integer`);
  return n;
}

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) fail("n2_candidate_invalid", `${field} is required`);
  return text;
}

function validateHostProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) fail("n2_host_invalid", "host profile is required");
  if (!profile.hardware || typeof profile.hardware !== "object") fail("n2_host_invalid", "host hardware identity is required");
  if (!SHA256.test(String(profile.hardwareFingerprintSha256 || ""))) fail("n2_host_invalid", "host hardware fingerprint must be SHA-256");
  const totalMemoryBytes = positiveInteger(profile.hardware?.memory?.totalBytes, "host.hardware.memory.totalBytes");
  const platform = requiredText(profile.hardware?.platform, "host.hardware.platform");
  const arch = requiredText(profile.hardware?.arch, "host.hardware.arch");
  const apple = Array.isArray(profile.hardware?.accelerators?.apple) ? profile.hardware.accelerators.apple : [];
  const nvidia = Array.isArray(profile.hardware?.accelerators?.nvidia) ? profile.hardware.accelerators.nvidia : [];
  return Object.freeze({ profile, totalMemoryBytes, platform, arch, apple, nvidia });
}

function validateCandidate(candidate, index) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("n2_candidate_invalid", `candidates[${index}] must be an object`);
  const engine = requiredText(candidate.engine, `candidates[${index}].engine`);
  if (!ENGINES.has(engine)) fail("n2_candidate_invalid", `unsupported engine: ${engine}`);
  const contextWindow = positiveInteger(candidate.contextWindow, `candidates[${index}].contextWindow`);
  if (contextWindow < 1024) fail("n2_candidate_invalid", `candidates[${index}].contextWindow must be >= 1024`);
  const maxConcurrentSequences = positiveInteger(candidate.maxConcurrentSequences, `candidates[${index}].maxConcurrentSequences`);
  const modelBytes = positiveInteger(candidate.modelBytes, `candidates[${index}].modelBytes`);
  const runtimeOverheadBytes = nonNegativeInteger(candidate.runtimeOverheadBytes, `candidates[${index}].runtimeOverheadBytes`);
  const kvBytesPerTokenPerSequence = positiveInteger(candidate.kvBytesPerTokenPerSequence, `candidates[${index}].kvBytesPerTokenPerSequence`);
  const extraWorkingSetBytes = nonNegativeInteger(candidate.extraWorkingSetBytes ?? 0, `candidates[${index}].extraWorkingSetBytes`);
  return Object.freeze({
    id: requiredText(candidate.id, `candidates[${index}].id`),
    engine,
    model: requiredText(candidate.model, `candidates[${index}].model`),
    quantization: requiredText(candidate.quantization, `candidates[${index}].quantization`),
    contextWindow,
    maxConcurrentSequences,
    modelBytes,
    runtimeOverheadBytes,
    kvBytesPerTokenPerSequence,
    extraWorkingSetBytes,
  });
}

function engineCompatibility(candidate, host) {
  if (candidate.engine === "mlx-lm") {
    const ok = host.platform === "darwin" && host.arch === "arm64";
    return { ok, reason: ok ? null : "mlx_lm_requires_apple_silicon" };
  }
  if (candidate.engine === "vllm") {
    const ok = host.platform === "linux" && host.nvidia.length > 0;
    return { ok, reason: ok ? null : "vllm_candidate_requires_linux_nvidia_host" };
  }
  return { ok: true, reason: null };
}

function memoryEstimate(candidate) {
  const kvBytes = candidate.kvBytesPerTokenPerSequence * candidate.contextWindow * candidate.maxConcurrentSequences;
  const requiredBytes = candidate.modelBytes + candidate.runtimeOverheadBytes + candidate.extraWorkingSetBytes + kvBytes;
  if (!Number.isSafeInteger(kvBytes) || !Number.isSafeInteger(requiredBytes)) fail("n2_candidate_invalid", `candidate ${candidate.id} memory estimate exceeds safe integer range`);
  return Object.freeze({ kvBytes, requiredBytes });
}

function boundedMemoryFraction(value) {
  if (value == null) return DEFAULT_MAX_HOST_MEMORY_FRACTION;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.50 || n > MAX_ALLOWED_HOST_MEMORY_FRACTION) {
    fail("n2_planner_invalid", `maxHostMemoryFraction must be between 0.50 and ${MAX_ALLOWED_HOST_MEMORY_FRACTION}`);
  }
  return n;
}

export function planNativeSemanticCandidates({ hostProfile, candidates, requiredContextWindow = 8192, requiredConcurrency = 1, maxHostMemoryFraction } = {}) {
  const host = validateHostProfile(hostProfile);
  if (!Array.isArray(candidates) || candidates.length === 0) fail("n2_planner_invalid", "at least one candidate is required");
  const requiredContext = positiveInteger(requiredContextWindow, "requiredContextWindow");
  const requiredConcurrent = positiveInteger(requiredConcurrency, "requiredConcurrency");
  const memoryFraction = boundedMemoryFraction(maxHostMemoryFraction);
  const memoryBudgetBytes = Math.floor(host.totalMemoryBytes * memoryFraction);

  const evaluations = candidates.map((raw, index) => {
    const candidate = validateCandidate(raw, index);
    const memory = memoryEstimate(candidate);
    const engine = engineCompatibility(candidate, host);
    const checks = Object.freeze({
      engineCompatibility: engine.ok,
      contextCapacity: candidate.contextWindow >= requiredContext,
      concurrencyCapacity: candidate.maxConcurrentSequences >= requiredConcurrent,
      memoryCapacity: memory.requiredBytes <= memoryBudgetBytes,
    });
    const admitted = Object.values(checks).every(Boolean);
    const reasons = [];
    if (!engine.ok) reasons.push(engine.reason);
    if (!checks.contextCapacity) reasons.push("insufficient_context_window");
    if (!checks.concurrencyCapacity) reasons.push("insufficient_concurrency_capacity");
    if (!checks.memoryCapacity) reasons.push("memory_budget_exceeded");
    const headroomBytes = Math.max(0, memoryBudgetBytes - memory.requiredBytes);
    return Object.freeze({
      id: candidate.id,
      engine: candidate.engine,
      model: candidate.model,
      quantization: candidate.quantization,
      admittedForQualification: admitted,
      checks,
      reasons: Object.freeze(reasons),
      memory: Object.freeze({ ...memory, budgetBytes: memoryBudgetBytes, headroomBytes }),
      requested: Object.freeze({ contextWindow: candidate.contextWindow, maxConcurrentSequences: candidate.maxConcurrentSequences }),
    });
  });

  const admitted = evaluations
    .filter((item) => item.admittedForQualification)
    .sort((a, b) => b.memory.headroomBytes - a.memory.headroomBytes || a.id.localeCompare(b.id));

  const decisionBody = {
    schema: N2_CANDIDATE_PLANNER_VERSION,
    hostHardwareFingerprintSha256: hostProfile.hardwareFingerprintSha256,
    memoryFraction,
    requiredContextWindow: requiredContext,
    requiredConcurrency: requiredConcurrent,
    evaluations,
    admittedCandidateIds: admitted.map((item) => item.id),
  };

  return Object.freeze({
    ...decisionBody,
    plannerDecisionSha256: sha256(canonicalJson(decisionBody)),
    nextAction: admitted.length ? "benchmark_admitted_candidates" : "no_candidate_safe_to_benchmark",
  });
}
