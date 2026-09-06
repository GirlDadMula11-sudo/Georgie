import { createHash } from "node:crypto";
import { canonicalJson } from "./native-hardware-profile.js";

export const N2_PROVENANCE_VERSION = "sierra.native-semantic-provenance.v1";
const SHA256 = /^[a-f0-9]{64}$/;
const ALLOWED_ENGINES = new Set(["llama.cpp", "mlx-lm", "vllm", "onnx-runtime-genai"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requiredObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("n2_provenance_invalid", `${field} must be an object`);
  return value;
}

function requiredArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) fail("n2_provenance_invalid", `${field} must be a non-empty array`);
  return value;
}

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) fail("n2_provenance_invalid", `${field} is required`);
  return text;
}

function requiredSha(value, field) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!SHA256.test(text)) fail("n2_provenance_invalid", `${field} must be a lowercase SHA-256 digest`);
  return text;
}

function requiredBoolean(value, field) {
  if (typeof value !== "boolean") fail("n2_provenance_invalid", `${field} must be boolean`);
  return value;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail("n2_provenance_invalid", `${field} must be a positive safe integer`);
  return number;
}

function boundedNumber(value, field, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail("n2_provenance_invalid", `${field} must be between ${min} and ${max}`);
  return number;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeDependency(dep, index) {
  const item = requiredObject(dep, `resolvedDependencies[${index}]`);
  return Object.freeze({
    name: requiredText(item.name, `resolvedDependencies[${index}].name`),
    source: requiredText(item.source, `resolvedDependencies[${index}].source`),
    revision: requiredText(item.revision, `resolvedDependencies[${index}].revision`),
    artifactSha256: requiredSha(item.artifactSha256, `resolvedDependencies[${index}].artifactSha256`),
  });
}

function normalizeRuntimeConfig(input) {
  const config = requiredObject(input, "runtimeConfig");
  return Object.freeze({
    contextWindow: positiveInteger(config.contextWindow, "runtimeConfig.contextWindow"),
    maxConcurrentSequences: positiveInteger(config.maxConcurrentSequences, "runtimeConfig.maxConcurrentSequences"),
    temperature: boundedNumber(config.temperature, "runtimeConfig.temperature", 0, 2),
    topP: boundedNumber(config.topP, "runtimeConfig.topP", 0, 1),
    seed: Number.isSafeInteger(Number(config.seed)) ? Number(config.seed) : fail("n2_provenance_invalid", "runtimeConfig.seed must be a safe integer"),
    promptCacheEnabled: requiredBoolean(config.promptCacheEnabled, "runtimeConfig.promptCacheEnabled"),
    speculativeDecodingEnabled: requiredBoolean(config.speculativeDecodingEnabled, "runtimeConfig.speculativeDecodingEnabled"),
    continuousBatchingEnabled: requiredBoolean(config.continuousBatchingEnabled, "runtimeConfig.continuousBatchingEnabled"),
    structuredOutputEnabled: requiredBoolean(config.structuredOutputEnabled, "runtimeConfig.structuredOutputEnabled"),
    structuredOutputSchemaSha256: requiredSha(config.structuredOutputSchemaSha256, "runtimeConfig.structuredOutputSchemaSha256"),
  });
}

export function validateN2ProvenanceAttestation(input) {
  const attestation = requiredObject(input, "attestation");
  const engine = requiredText(attestation.engine?.name, "engine.name");
  if (!ALLOWED_ENGINES.has(engine)) fail("n2_provenance_invalid", `unsupported engine: ${engine}`);

  const resolvedDependencies = requiredArray(attestation.resolvedDependencies, "resolvedDependencies")
    .map(normalizeDependency)
    .sort((a, b) => `${a.name}:${a.source}:${a.revision}`.localeCompare(`${b.name}:${b.source}:${b.revision}`));

  const body = {
    schema: N2_PROVENANCE_VERSION,
    builder: {
      id: requiredText(attestation.builder?.id, "builder.id"),
      revision: requiredText(attestation.builder?.revision, "builder.revision"),
    },
    engine: {
      name: engine,
      source: requiredText(attestation.engine?.source, "engine.source"),
      revision: requiredText(attestation.engine?.revision, "engine.revision"),
      artifactSha256: requiredSha(attestation.engine?.artifactSha256, "engine.artifactSha256"),
    },
    model: {
      source: requiredText(attestation.model?.source, "model.source"),
      revision: requiredText(attestation.model?.revision, "model.revision"),
      artifactSha256: requiredSha(attestation.model?.artifactSha256, "model.artifactSha256"),
      tokenizerRevision: requiredText(attestation.model?.tokenizerRevision, "model.tokenizerRevision"),
      tokenizerBundleSha256: requiredSha(attestation.model?.tokenizerBundleSha256, "model.tokenizerBundleSha256"),
      quantization: requiredText(attestation.model?.quantization, "model.quantization"),
    },
    runtimeConfig: normalizeRuntimeConfig(attestation.runtimeConfig),
    resolvedDependencies,
  };

  return Object.freeze({
    ...body,
    provenanceSha256: sha256(canonicalJson(body)),
    runtimeConfigSha256: sha256(canonicalJson(body.runtimeConfig)),
  });
}

export function assertProvenanceMatchesManifest({ provenance, manifest, expectedRuntimeConfigSha256 } = {}) {
  const attested = validateN2ProvenanceAttestation(provenance);
  const pinned = requiredObject(manifest, "manifest");
  const mismatches = [];

  if (attested.engine.name !== pinned.engine?.name) mismatches.push("engine.name");
  if (attested.engine.source !== pinned.engine?.source) mismatches.push("engine.source");
  if (attested.engine.revision !== pinned.engine?.revision) mismatches.push("engine.revision");
  if (attested.engine.artifactSha256 !== String(pinned.engine?.artifactSha256 || "").toLowerCase()) mismatches.push("engine.artifactSha256");
  if (attested.model.source !== pinned.model?.source) mismatches.push("model.source");
  if (attested.model.revision !== pinned.model?.revision) mismatches.push("model.revision");
  if (attested.model.artifactSha256 !== String(pinned.model?.artifactSha256 || "").toLowerCase()) mismatches.push("model.artifactSha256");
  if (attested.model.quantization !== pinned.model?.quantization) mismatches.push("model.quantization");
  if (attested.runtimeConfig.contextWindow !== Number(pinned.model?.contextWindow)) mismatches.push("runtimeConfig.contextWindow");

  if (expectedRuntimeConfigSha256 != null) {
    const expected = requiredSha(expectedRuntimeConfigSha256, "expectedRuntimeConfigSha256");
    if (attested.runtimeConfigSha256 !== expected) mismatches.push("runtimeConfigSha256");
  }

  if (mismatches.length) {
    fail("n2_provenance_binding_mismatch", `provenance does not match candidate manifest: ${mismatches.join(", ")}`);
  }

  return Object.freeze({
    matched: true,
    provenanceSha256: attested.provenanceSha256,
    runtimeConfigSha256: attested.runtimeConfigSha256,
  });
}
