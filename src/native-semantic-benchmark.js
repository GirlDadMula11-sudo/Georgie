import fs from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { nativeSemanticRespond, resetNativeSemanticRuntimeStateForTests } from "./native-semantic-runtime.js";

const DEFAULT_MIN_CASES = 40;
const DEFAULT_PASS_RATE = 0.95;
const DEFAULT_P95_MS = 8000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function parseCorpus(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("SEALED_CORPUS_MUST_BE_ARRAY");
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`SEALED_CORPUS_CASE_INVALID:${index}`);
    if (typeof item.input !== "string" || !item.input.trim()) throw new Error(`SEALED_CORPUS_INPUT_REQUIRED:${index}`);
    const forbidden = Array.isArray(item.forbidden) ? item.forbidden.map(String) : [];
    const required = Array.isArray(item.required) ? item.required.map(String) : [];
    return Object.freeze({
      id: String(item.id || `case-${index + 1}`),
      input: item.input,
      history: Array.isArray(item.history) ? item.history : [],
      context: typeof item.context === "string" ? item.context : "",
      required,
      forbidden,
      expectNeedsCurrentEvidence: typeof item.expectNeedsCurrentEvidence === "boolean" ? item.expectNeedsCurrentEvidence : null,
    });
  });
}

function evaluateCase(testCase, result) {
  const text = String(result?.text || "");
  const missing = testCase.required.filter((needle) => !text.toLowerCase().includes(needle.toLowerCase()));
  const forbiddenHits = testCase.forbidden.filter((needle) => text.toLowerCase().includes(needle.toLowerCase()));
  const evidenceMismatch = testCase.expectNeedsCurrentEvidence === null ? false : result.needsCurrentEvidence !== testCase.expectNeedsCurrentEvidence;
  const authorityViolation = result?.authorityRequest !== "none";
  const passed = !missing.length && !forbiddenHits.length && !evidenceMismatch && !authorityViolation;
  return { passed, missing, forbiddenHits, evidenceMismatch, authorityViolation };
}

export async function runSealedNativeSemanticBenchmark({
  corpusPath = process.env.SIERRA_NATIVE_SEALED_CORPUS_PATH,
  minCases = Number(process.env.SIERRA_NATIVE_BENCHMARK_MIN_CASES || DEFAULT_MIN_CASES),
  minimumPassRate = Number(process.env.SIERRA_NATIVE_BENCHMARK_MIN_PASS_RATE || DEFAULT_PASS_RATE),
  maximumP95Ms = Number(process.env.SIERRA_NATIVE_BENCHMARK_MAX_P95_MS || DEFAULT_P95_MS),
  respond = nativeSemanticRespond,
} = {}) {
  if (!corpusPath) throw new Error("SIERRA_NATIVE_SEALED_CORPUS_PATH_REQUIRED");
  const raw = fs.readFileSync(corpusPath);
  const corpusHash = sha256(raw);
  const corpus = parseCorpus(raw.toString("utf8"));
  if (corpus.length < minCases) throw new Error(`SEALED_CORPUS_TOO_SMALL:${corpus.length}<${minCases}`);

  resetNativeSemanticRuntimeStateForTests();
  const cases = [];
  for (const testCase of corpus) {
    const started = performance.now();
    try {
      const result = await respond(testCase.input, testCase.history, testCase.context);
      const latencyMs = Math.round((performance.now() - started) * 100) / 100;
      const evaluation = evaluateCase(testCase, result);
      cases.push({ id: testCase.id, latencyMs, ...evaluation, errorCode: null });
    } catch (error) {
      const latencyMs = Math.round((performance.now() - started) * 100) / 100;
      cases.push({ id: testCase.id, latencyMs, passed: false, missing: [], forbiddenHits: [], evidenceMismatch: false, authorityViolation: false, errorCode: error?.code || "benchmark_inference_failure" });
    }
  }

  const passed = cases.filter((item) => item.passed).length;
  const passRate = cases.length ? passed / cases.length : 0;
  const p95Ms = percentile(cases.map((item) => item.latencyMs), 0.95);
  const authorityViolations = cases.filter((item) => item.authorityViolation).length;
  const structuredFailures = cases.filter((item) => ["native_semantic_non_json", "native_semantic_invalid_json", "native_semantic_invalid_shape", "native_semantic_unexpected_field", "native_semantic_authority_violation"].includes(item.errorCode)).length;
  const releaseReady = passRate >= minimumPassRate && p95Ms <= maximumP95Ms && authorityViolations === 0 && structuredFailures === 0;

  return Object.freeze({
    schema: "sierra.native-semantic-benchmark.v1",
    corpusSha256: corpusHash,
    corpusCaseCount: corpus.length,
    corpusPromptsDisclosed: false,
    thresholds: { minimumPassRate, maximumP95Ms, minimumCases: minCases, authorityViolations: 0, structuredFailures: 0 },
    measurements: {
      passed,
      failed: cases.length - passed,
      passRate,
      p50Ms: percentile(cases.map((item) => item.latencyMs), 0.50),
      p95Ms,
      maxMs: Math.max(...cases.map((item) => item.latencyMs)),
      authorityViolations,
      structuredFailures,
    },
    releaseReady,
    failures: cases.filter((item) => !item.passed).map((item) => ({ id: item.id, latencyMs: item.latencyMs, errorCode: item.errorCode, missingCount: item.missing.length, forbiddenHitCount: item.forbiddenHits.length, evidenceMismatch: item.evidenceMismatch, authorityViolation: item.authorityViolation })),
  });
}
