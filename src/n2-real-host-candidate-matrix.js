import { createHash } from "node:crypto";
import { canonicalJson } from "./native-hardware-profile.js";

export const N2_REAL_HOST_MATRIX_VERSION = "sierra.n2-real-host-candidate-matrix.v1";

export const N2_REAL_HOST = Object.freeze({
  hardwareFingerprintSha256: "b08acdef052238704e0c288211a022731bdb80e9aff87366d38154cecdadf089",
  platform: "darwin",
  arch: "x64",
  totalMemoryBytes: 8589934592,
  cpuModel: "Intel(R) Core(TM) i5-7500 CPU @ 3.40GHz",
});

export const N2_LLAMA_CPP = Object.freeze({
  repository: "https://github.com/ggml-org/llama.cpp.git",
  tag: "v0.4.0",
  commit: "5266f24da75dc449bd56cbed7addb9c8e4a6a73e",
  build: Object.freeze({
    metal: false,
    accelerate: true,
    buildType: "Release",
  }),
});

const BASELINE_RUNTIME = Object.freeze({
  contextWindow: 4096,
  parallel: 1,
  threads: 4,
  batchSize: 256,
  microBatchSize: 128,
  cacheTypeK: "q8_0",
  cacheTypeV: "q8_0",
  loadMode: "mmap",
  promptCache: false,
  speculativeDecoding: false,
  ui: false,
  tools: false,
  host: "127.0.0.1",
});

export const N2_REAL_HOST_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "qwen3-4b-q4-k-m",
    engine: "llama.cpp",
    model: "Qwen/Qwen3-4B-GGUF",
    sourceRevision: "main@artifact-sha256",
    file: "Qwen3-4B-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true",
    artifactSha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
    artifactBytes: 2497280256,
    quantization: "Q4_K_M",
    tokenizerIdentity: "embedded-in-gguf",
    runtime: BASELINE_RUNTIME,
  }),
  Object.freeze({
    id: "gemma-3-4b-it-q4-k-m",
    engine: "llama.cpp",
    model: "ggml-org/gemma-3-4b-it-GGUF",
    sourceRevision: "main@artifact-sha256",
    file: "gemma-3-4b-it-Q4_K_M.gguf",
    downloadUrl: "https://huggingface.co/ggml-org/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf?download=true",
    artifactSha256: "882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863",
    artifactBytes: 2489757856,
    quantization: "Q4_K_M",
    tokenizerIdentity: "embedded-in-gguf",
    runtime: BASELINE_RUNTIME,
  }),
]);

export function n2RealHostMatrixReceipt() {
  const body = {
    schema: N2_REAL_HOST_MATRIX_VERSION,
    host: N2_REAL_HOST,
    engine: N2_LLAMA_CPP,
    candidates: N2_REAL_HOST_CANDIDATES,
    policy: {
      oneCandidateAtATime: true,
      promotionOnLaunch: false,
      baselinePromptCacheDisabled: true,
      baselineSpeculativeDecodingDisabled: true,
      serverLoopbackOnly: true,
      builtInToolsDisabled: true,
      webUiDisabled: true,
    },
  };
  return Object.freeze({
    ...body,
    matrixSha256: createHash("sha256").update(canonicalJson(body), "utf8").digest("hex"),
  });
}
