import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { N2_REAL_HOST, N2_LLAMA_CPP, N2_REAL_HOST_CANDIDATES, n2RealHostMatrixReceipt } from "../src/n2-real-host-candidate-matrix.js";

const SHA256 = /^[a-f0-9]{64}$/;

test("real-host N2 matrix stays pinned to measured Intel primary-mac", () => {
  assert.equal(N2_REAL_HOST.platform, "darwin");
  assert.equal(N2_REAL_HOST.arch, "x64");
  assert.equal(N2_REAL_HOST.totalMemoryBytes, 8589934592);
  assert.match(N2_REAL_HOST.hardwareFingerprintSha256, SHA256);
  assert.equal(N2_LLAMA_CPP.commit, "5266f24da75dc449bd56cbed7addb9c8e4a6a73e");
  assert.equal(N2_LLAMA_CPP.build.metal, false);
});

test("candidate matrix uses one-at-a-time low-memory baseline with pinned GGUF hashes", () => {
  assert.equal(N2_REAL_HOST_CANDIDATES.length, 2);
  for (const candidate of N2_REAL_HOST_CANDIDATES) {
    assert.equal(candidate.engine, "llama.cpp");
    assert.equal(candidate.quantization, "Q4_K_M");
    assert.match(candidate.artifactSha256, SHA256);
    assert.ok(candidate.artifactBytes > 2_000_000_000 && candidate.artifactBytes < 3_000_000_000);
    assert.equal(candidate.runtime.contextWindow, 4096);
    assert.equal(candidate.runtime.parallel, 1);
    assert.equal(candidate.runtime.cacheTypeK, "q8_0");
    assert.equal(candidate.runtime.cacheTypeV, "q8_0");
    assert.equal(candidate.runtime.promptCache, false);
    assert.equal(candidate.runtime.speculativeDecoding, false);
    assert.equal(candidate.runtime.host, "127.0.0.1");
  }
});

test("matrix receipt is immutable and never grants promotion authority", () => {
  const receipt = n2RealHostMatrixReceipt();
  assert.match(receipt.matrixSha256, SHA256);
  assert.equal(receipt.policy.promotionOnLaunch, false);
  assert.equal(receipt.policy.serverLoopbackOnly, true);
  assert.equal(receipt.policy.builtInToolsDisabled, true);
  assert.equal(receipt.policy.webUiDisabled, true);
});

test("real-host campaign is isolated, hash-verifying, loopback-only and non-promoting", () => {
  const source = fs.readFileSync(new URL("../scripts/run-n2-real-host-qualification.mjs", import.meta.url), "utf8");
  for (const required of [
    "N2-Qualification",
    "n2_model_hash_mismatch",
    "n2_model_size_mismatch",
    "--host",
    "127.0.0.1",
    "--no-ui",
    "promotionAuthority: \"none\"",
    "forcedCrashRestarts: 1",
    "SIGKILL",
    "N2_QUALIFICATION_CAMPAIGN_JSON",
  ]) assert.ok(source.includes(required), `missing safety invariant: ${required}`);
  assert.ok(!source.includes("--tools"), "qualification server must not enable llama.cpp built-in tools");
});
