import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalJson } from "../src/native-hardware-profile.js";
import { assertProvenanceMatchesManifest, validateN2ProvenanceAttestation } from "../src/native-provenance-attestation.js";

const H = "a".repeat(64);
const E = "b".repeat(64);
const M = "c".repeat(64);
const T = "d".repeat(64);
const S = "e".repeat(64);

const manifest = {
  engine: { name: "llama.cpp", source: "ggml-org/llama.cpp", revision: "engine-rev", artifactSha256: E },
  model: { source: "sierra/model", revision: "model-rev", file: "model.gguf", artifactSha256: M, quantization: "Q4_K_M", contextWindow: 32768 },
  tokenizer: { revision: "tok-rev", files: [{ path: "tokenizer.json", sha256: T }] },
  hardware: { fingerprintSha256: H },
};

const tokenizerBundleSha256 = createHash("sha256")
  .update(canonicalJson({ revision: "tok-rev", files: [{ path: "tokenizer.json", sha256: T }] }), "utf8")
  .digest("hex");

const provenance = {
  builder: { id: "sierra:n2-artifact-builder", revision: "builder-rev" },
  engine: { name: "llama.cpp", source: "ggml-org/llama.cpp", revision: "engine-rev", artifactSha256: E },
  model: {
    source: "sierra/model",
    revision: "model-rev",
    artifactSha256: M,
    tokenizerRevision: "tok-rev",
    tokenizerBundleSha256,
    quantization: "Q4_K_M",
  },
  runtimeConfig: {
    contextWindow: 32768,
    maxConcurrentSequences: 2,
    temperature: 0,
    topP: 1,
    seed: 42,
    promptCacheEnabled: false,
    speculativeDecodingEnabled: false,
    continuousBatchingEnabled: false,
    structuredOutputEnabled: true,
    structuredOutputSchemaSha256: S,
  },
  resolvedDependencies: [
    { name: "runtime-lib", source: "sierra/runtime-lib", revision: "r1", artifactSha256: H },
  ],
};

test("provenance produces stable artifact and runtime configuration identities", () => {
  const result = validateN2ProvenanceAttestation(provenance);
  assert.match(result.provenanceSha256, /^[a-f0-9]{64}$/);
  assert.match(result.runtimeConfigSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.runtimeConfig.promptCacheEnabled, false);
  assert.equal(result.runtimeConfig.speculativeDecodingEnabled, false);
});

test("provenance matches the pinned engine, model, tokenizer, quantization, and context", () => {
  const result = assertProvenanceMatchesManifest({ provenance, manifest });
  assert.equal(result.matched, true);
});

test("tokenizer drift fails closed", () => {
  const changed = { ...provenance, model: { ...provenance.model, tokenizerBundleSha256: H } };
  assert.throws(
    () => assertProvenanceMatchesManifest({ provenance: changed, manifest }),
    (error) => error?.code === "n2_provenance_binding_mismatch",
  );
});

test("runtime configuration drift can be pinned independently of artifact identity", () => {
  const validated = validateN2ProvenanceAttestation(provenance);
  const changed = { ...provenance, runtimeConfig: { ...provenance.runtimeConfig, promptCacheEnabled: true } };
  assert.throws(
    () => assertProvenanceMatchesManifest({ provenance: changed, manifest, expectedRuntimeConfigSha256: validated.runtimeConfigSha256 }),
    (error) => error?.code === "n2_provenance_binding_mismatch",
  );
});

test("model artifact drift fails closed", () => {
  const changed = { ...provenance, model: { ...provenance.model, artifactSha256: H } };
  assert.throws(
    () => assertProvenanceMatchesManifest({ provenance: changed, manifest }),
    (error) => error?.code === "n2_provenance_binding_mismatch",
  );
});
