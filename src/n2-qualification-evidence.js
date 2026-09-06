import { createHash } from "node:crypto";
import { canonicalJson } from "./native-hardware-profile.js";
import { N2_PROMOTION_THRESHOLDS } from "./native-semantic-promotion.js";

const SHA256 = /^[a-f0-9]{64}$/;

export const N2_QUALIFICATION_EVIDENCE_SCHEMA = "sierra.n2-qualification-evidence.v2";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function digest(value, field) {
  const text = String(value || "").trim().toLowerCase();
  if (!SHA256.test(text)) fail("n2_qualification_invalid", `${field} must be a lowercase SHA-256 digest`);
  return text;
}

function text(value, field) {
  const result = String(value || "").trim();
  if (!result) fail("n2_qualification_invalid", `${field} is required`);
  return result;
}

function integer(value, field, { minimum = 0 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) fail("n2_qualification_invalid", `${field} must be an integer >= ${minimum}`);
  return number;
}

function finite(value, field, { minimum = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) fail("n2_qualification_invalid", `${field} must be a finite number >= ${minimum}`);
  return number;
}

function optionalFinite(value, field, options = {}) {
  if (value == null) return null;
  return finite(value, field, options);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function nearestRank(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.map((value, index) => finite(value, `samples[${index}]`)).sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1];
}

export function summarizeLatencySamples(samples = []) {
  if (!Array.isArray(samples)) fail("n2_qualification_invalid", "latency samples must be an array");
  if (samples.length === 0) return Object.freeze({ count: 0, minMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, meanMs: null });
  const normalized = samples.map((value, index) => finite(value, `latencySamples[${index}]`));
  const sum = normalized.reduce((total, value) => total + value, 0);
  return Object.freeze({
    count: normalized.length,
    minMs: Math.min(...normalized),
    p50Ms: nearestRank(normalized, 0.50),
    p95Ms: nearestRank(normalized, 0.95),
    p99Ms: nearestRank(normalized, 0.99),
    maxMs: Math.max(...normalized),
    meanMs: sum / normalized.length,
  });
}

function normalizeThermalSamples(samples = []) {
  if (!Array.isArray(samples)) fail("n2_qualification_invalid", "thermal.samples must be an array");
  return Object.freeze(samples.map((sample, index) => {
    if (!sample || typeof sample !== "object" || Array.isArray(sample)) fail("n2_qualification_invalid", `thermal.samples[${index}] must be an object`);
    return Object.freeze({
      atRequest: integer(sample.atRequest, `thermal.samples[${index}].atRequest`),
      cpuThermalLevel: optionalFinite(sample.cpuThermalLevel, `thermal.samples[${index}].cpuThermalLevel`),
      speedLimit: optionalFinite(sample.speedLimit, `thermal.samples[${index}].speedLimit`, { minimum: 0 }),
      schedulerLimit: optionalFinite(sample.schedulerLimit, `thermal.samples[${index}].schedulerLimit`, { minimum: 0 }),
      availableCpus: optionalFinite(sample.availableCpus, `thermal.samples[${index}].availableCpus`, { minimum: 0 }),
    });
  }));
}

function thresholdChecks({ semantic, adversarial, outage, stress, failure }) {
  const t = N2_PROMOTION_THRESHOLDS;
  const errorRate = ratio(stress.errorCount, stress.requests);
  const mismatchRate = ratio(stress.determinismMismatches, stress.determinismComparisons);
  const memoryUtilization = stress.memoryLimitBytes > 0 ? stress.peakRssBytes / stress.memoryLimitBytes : null;
  const qualityPassRate = ratio(semantic.passed, semantic.cases);
  const shadowDeferred = true;

  return Object.freeze({
    sealedCaseCount: semantic.cases >= t.minimumSealedCases,
    quality: qualityPassRate != null && qualityPassRate >= t.minimumQualityPassRate,
    structuredFailClosed: semantic.structuredFailOpen <= t.maximumStructuredFailOpen,
    adversarialCoverage: adversarial.cases >= t.minimumAdversarialCases,
    authority: adversarial.authorityViolations <= t.maximumAuthorityViolations,
    promptInjection: adversarial.promptInjectionEscapes <= t.maximumPromptInjectionEscapes,
    providerOutageCoverage: outage.cases >= t.minimumProviderOutageCases,
    providerOutage: outage.terminalFailures <= t.maximumProviderOutageTerminalFailures,
    stressCoverage: stress.requests >= t.minimumStressRequests,
    forcedCrashCoverage: failure.forcedCrashRestarts >= t.minimumForcedCrashRestarts,
    forcedTimeoutCoverage: failure.forcedTimeouts >= t.minimumForcedTimeouts,
    crashIntegrity: failure.corruptionEvents <= t.maximumCrashCorruptionEvents,
    crashRecovery: failure.crashRecoveryFailures <= t.maximumCrashRecoveryFailures,
    timeoutRecovery: failure.timeoutRecoveryFailures <= t.maximumTimeoutRecoveryFailures,
    reliability: errorRate != null && errorRate <= t.maximumErrorRate,
    determinism: mismatchRate != null && mismatchRate <= t.maximumDeterminismMismatchRate,
    memoryHeadroom: memoryUtilization != null && memoryUtilization <= t.maximumMemoryUtilization,
    firstTokenLatency: stress.firstToken.p95Ms != null && stress.firstToken.p95Ms <= t.maximumP95FirstTokenMs,
    totalLatency: stress.total.p95Ms != null && stress.total.p95Ms <= t.maximumP95TotalMs,
    shadowDeferred,
  });
}

export function buildN2QualificationEvidence(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("n2_qualification_invalid", "qualification evidence must be an object");

  const semantic = Object.freeze({
    corpusSha256: digest(input.semantic?.corpusSha256, "semantic.corpusSha256"),
    cases: integer(input.semantic?.cases, "semantic.cases"),
    passed: integer(input.semantic?.passed, "semantic.passed"),
    structuredFailOpen: integer(input.semantic?.structuredFailOpen, "semantic.structuredFailOpen"),
  });
  if (semantic.passed > semantic.cases) fail("n2_qualification_invalid", "semantic.passed cannot exceed semantic.cases");

  const adversarial = Object.freeze({
    corpusSha256: digest(input.adversarial?.corpusSha256, "adversarial.corpusSha256"),
    cases: integer(input.adversarial?.cases, "adversarial.cases"),
    authorityViolations: integer(input.adversarial?.authorityViolations, "adversarial.authorityViolations"),
    promptInjectionEscapes: integer(input.adversarial?.promptInjectionEscapes, "adversarial.promptInjectionEscapes"),
  });

  const outage = Object.freeze({
    corpusSha256: digest(input.outage?.corpusSha256, "outage.corpusSha256"),
    cases: integer(input.outage?.cases, "outage.cases"),
    terminalFailures: integer(input.outage?.terminalFailures, "outage.terminalFailures"),
  });

  const total = summarizeLatencySamples(input.stress?.totalMs || []);
  const firstToken = summarizeLatencySamples(input.stress?.firstTokenMs || []);
  const requests = integer(input.stress?.requests, "stress.requests");
  if (total.count > requests || firstToken.count > requests) fail("n2_qualification_invalid", "latency sample counts cannot exceed stress.requests");
  const errorCount = integer(input.stress?.errorCount, "stress.errorCount");
  if (errorCount > requests) fail("n2_qualification_invalid", "stress.errorCount cannot exceed stress.requests");
  const determinismComparisons = integer(input.stress?.determinismComparisons, "stress.determinismComparisons");
  const determinismMismatches = integer(input.stress?.determinismMismatches, "stress.determinismMismatches");
  if (determinismMismatches > determinismComparisons) fail("n2_qualification_invalid", "stress.determinismMismatches cannot exceed determinismComparisons");

  const stress = Object.freeze({
    requests,
    errorCount,
    errorRate: ratio(errorCount, requests),
    total,
    firstToken,
    outputTokens: integer(input.stress?.outputTokens, "stress.outputTokens"),
    wallMs: finite(input.stress?.wallMs, "stress.wallMs", { minimum: 1 }),
    throughputTokensPerSecond: Number(input.stress?.outputTokens || 0) / (Number(input.stress?.wallMs) / 1000),
    peakRssBytes: integer(input.stress?.peakRssBytes, "stress.peakRssBytes"),
    memoryLimitBytes: integer(input.stress?.memoryLimitBytes, "stress.memoryLimitBytes", { minimum: 1 }),
    memoryUtilization: Number(input.stress?.peakRssBytes) / Number(input.stress?.memoryLimitBytes),
    swapBytesAtStart: integer(input.stress?.swapBytesAtStart ?? 0, "stress.swapBytesAtStart"),
    swapBytesAtEnd: integer(input.stress?.swapBytesAtEnd ?? 0, "stress.swapBytesAtEnd"),
    swapGrowthBytes: Math.max(0, Number(input.stress?.swapBytesAtEnd ?? 0) - Number(input.stress?.swapBytesAtStart ?? 0)),
    determinismComparisons,
    determinismMismatches,
    determinismMismatchRate: ratio(determinismMismatches, determinismComparisons),
  });

  const failure = Object.freeze({
    forcedCrashRestarts: integer(input.failure?.forcedCrashRestarts, "failure.forcedCrashRestarts"),
    crashRecoveryFailures: integer(input.failure?.crashRecoveryFailures, "failure.crashRecoveryFailures"),
    corruptionEvents: integer(input.failure?.corruptionEvents, "failure.corruptionEvents"),
    forcedTimeouts: integer(input.failure?.forcedTimeouts, "failure.forcedTimeouts"),
    timeoutRecoveryFailures: integer(input.failure?.timeoutRecoveryFailures, "failure.timeoutRecoveryFailures"),
    restartReadyMs: summarizeLatencySamples(input.failure?.restartReadyMs || []),
  });

  const thermal = Object.freeze({
    source: text(input.thermal?.source || "unavailable", "thermal.source"),
    samples: normalizeThermalSamples(input.thermal?.samples || []),
    unavailableReason: input.thermal?.unavailableReason == null ? null : String(input.thermal.unavailableReason).trim().slice(0, 500),
  });

  const coldStart = Object.freeze({
    processColdStartMs: summarizeLatencySamples(input.coldStart?.processColdStartMs || []),
    osCacheState: String(input.coldStart?.osCacheState || "uncontrolled").trim() || "uncontrolled",
    note: String(input.coldStart?.note || "Process-cold measurement; OS page-cache state is explicitly not assumed cold.").trim().slice(0, 1000),
  });

  const normalized = {
    schema: N2_QUALIFICATION_EVIDENCE_SCHEMA,
    candidate: {
      id: text(input.candidate?.id, "candidate.id"),
      matrixSha256: digest(input.candidate?.matrixSha256, "candidate.matrixSha256"),
      manifestSha256: digest(input.candidate?.manifestSha256, "candidate.manifestSha256"),
    },
    host: {
      hardwareFingerprintSha256: digest(input.host?.hardwareFingerprintSha256, "host.hardwareFingerprintSha256"),
      runtimeFingerprintSha256: digest(input.host?.runtimeFingerprintSha256, "host.runtimeFingerprintSha256"),
    },
    engine: {
      sourceCommit: text(input.engine?.sourceCommit, "engine.sourceCommit"),
      binarySha256: digest(input.engine?.binarySha256, "engine.binarySha256"),
    },
    model: {
      artifactSha256: digest(input.model?.artifactSha256, "model.artifactSha256"),
      artifactBytes: integer(input.model?.artifactBytes, "model.artifactBytes", { minimum: 1 }),
      quantization: text(input.model?.quantization, "model.quantization"),
    },
    runtimeConfigSha256: digest(input.runtimeConfigSha256, "runtimeConfigSha256"),
    semantic,
    adversarial,
    outage,
    coldStart,
    stress,
    thermal,
    failure,
    promotionAuthority: "none",
  };

  const checks = thresholdChecks({ semantic, adversarial, outage, stress, failure });
  const requiredBeforeShadow = Object.entries(checks).filter(([name]) => name !== "shadowDeferred");
  const eligibleForShadowComparison = requiredBeforeShadow.every(([, passed]) => passed === true);
  const body = Object.freeze({
    ...normalized,
    checks,
    qualificationState: eligibleForShadowComparison ? "eligible_for_shadow_comparison" : "qualification_incomplete_or_failed",
    eligibleForShadowComparison,
    nextGate: eligibleForShadowComparison ? "sealed_shadow_comparison" : "repair_or_requalify",
  });
  const receiptSha256 = createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
  return Object.freeze({ ...body, receiptSha256 });
}
