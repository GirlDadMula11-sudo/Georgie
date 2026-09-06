import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalJson } from "../src/native-hardware-profile.js";
import { orchestrateN2Qualification } from "../src/native-qualification-orchestrator.js";
import { validateNativeCandidateManifest } from "../src/native-semantic-promotion.js";
import { validateN2ProvenanceAttestation } from "../src/native-provenance-attestation.js";

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

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function tokenizerBundleSha256() {
  return sha256(canonicalJson({
    revision: manifest.tokenizer.revision,
    files: [...manifest.tokenizer.files].sort((a, b) => a.path.localeCompare(b.path)),
  }));
}

function provenance(overrides = {}) {
  return {
    builder: { id: "sierra/n2-builder", revision: "builder-rev-1" },
    engine: { ...manifest.engine },
    model: {
      source: manifest.model.source,
      revision: manifest.model.revision,
      artifactSha256: manifest.model.artifactSha256,
      tokenizerRevision: manifest.tokenizer.revision,
      tokenizerBundleSha256: tokenizerBundleSha256(),
      quantization: manifest.model.quantization,
    },
    runtimeConfig: {
      contextWindow: 32768,
      maxConcurrentSequences: 4,
      temperature: 0,
      topP: 1,
      seed: 7,
      promptCacheEnabled: false,
      speculativeDecodingEnabled: false,
      continuousBatchingEnabled: false,
      structuredOutputEnabled: true,
      structuredOutputSchemaSha256: H,
    },
    resolvedDependencies: [
      { name: "runtime", source: "sierra/runtime", revision: "dep-rev-1", artifactSha256: H },
    ],
    ...overrides,
  };
}

function evidence(prov = provenance()) {
  const attested = validateN2ProvenanceAttestation(prov);
  const binding = {
    candidateManifestSha256: manifestSha,
    hostHardwareFingerprintSha256: H,
    provenanceSha256: attested.provenanceSha256,
    runtimeConfigSha256: attested.runtimeConfigSha256,
  };
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

function request(prov = provenance(), e = evidence(prov)) {
  return {
    hostProfile,
    candidates,
    selectedCandidateId: "candidate-a",
    candidateManifest: manifest,
    provenance: prov,
    corpusSha256: C,
    ...e,
  };
}

test("qualification binds admitted candidate, host, provenance, runtime config, corpus, and evidence before canary eligibility", () => {
  const prov = provenance();
  const result = orchestrateN2Qualification(request(prov));
  assert.equal(result.promotion.productionAuthority, "eligible_for_controlled_canary");
  assert.equal(result.nextAction, "controlled_canary_only");
  assert.equal(result.hostHardwareFingerprintSha256, H);
  assert.equal(result.corpusSha256, C);
  assert.match(result.provenanceSha256, /^[a-f0-9]{64}$/);
  assert.match(result.runtimeConfigSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.selectedManifestChecks, {
    engine: true,
    model: true,
    quantization: true,
    contextWindow: true,
  });
  assert.deepEqual(result.selectedProvenanceChecks, {
    contextWindow: true,
    maxConcurrentSequences: true,
  });
  assert.match(result.qualificationReceiptSha256, /^[a-f0-9]{64}$/);
});

test("qualification rejects evidence from a different candidate", () => {
  const prov = provenance();
  const e = evidence(prov);
  e.adversarial = { ...e.adversarial, candidateManifestSha256: "c".repeat(64) };
  assert.throws(() => orchestrateN2Qualification(request(prov, e)), (error) => error?.code === "n2_qualification_binding_mismatch");
});

test("qualification rejects sealed evidence from a different corpus", () => {
  const prov = provenance();
  const e = evidence(prov);
  e.sealed = { ...e.sealed, corpusSha256: "d".repeat(64) };
  assert.throws(() => orchestrateN2Qualification(request(prov, e)), (error) => error?.code === "n2_qualification_binding_mismatch");
});

test("qualification rejects evidence after runtime configuration drift", () => {
  const original = provenance();
  const staleEvidence = evidence(original);
  const changed = provenance({
    runtimeConfig: { ...original.runtimeConfig, promptCacheEnabled: true },
  });
  assert.throws(() => orchestrateN2Qualification(request(changed, staleEvidence)), (error) => error?.code === "n2_qualification_binding_mismatch");
});

test("qualification rejects evidence after provenance dependency drift", () => {
  const original = provenance();
  const staleEvidence = evidence(original);
  const changed = provenance({
    resolvedDependencies: [{ name: "runtime", source: "sierra/runtime", revision: "dep-rev-2", artifactSha256: H }],
  });
  assert.throws(() => orchestrateN2Qualification(request(changed, staleEvidence)), (error) => error?.code === "n2_qualification_binding_mismatch");
});

test("qualification rejects runtime concurrency that does not match admitted planner candidate", () => {
  const original = provenance();
  const changed = provenance({
    runtimeConfig: { ...original.runtimeConfig, maxConcurrentSequences: 2 },
  });
  assert.throws(() => orchestrateN2Qualification(request(changed, evidence(changed))), (error) => error?.code === "n2_qualification_binding_mismatch");
});

test("qualification rejects a manifest for a different planner candidate", () => {
  assert.throws(() => orchestrateN2Qualification({
    ...request(),
    candidateManifest: { ...manifest, model: { ...manifest.model, source: "different/model" } },
  }), (error) => error?.code === "n2_qualification_binding_mismatch");
});

test("qualification rejects manifest quantization or context drift", () => {
  for (const model of [
    { ...manifest.model, quantization: "fp16" },
    { ...manifest.model, contextWindow: 16384 },
  ]) {
    assert.throws(() => orchestrateN2Qualification({
      ...request(),
      candidateManifest: { ...manifest, model },
    }), (error) => error?.code === "n2_qualification_binding_mismatch");
  }
});
