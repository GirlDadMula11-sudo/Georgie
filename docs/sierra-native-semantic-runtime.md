# Sierra Native Semantic Runtime (N2)

## Objective

N2 is Georgie's replaceable private semantic inference layer. It sits below Sierra's deterministic policy/tool/evidence control plane and above interchangeable inference engines. It is not Georgie's identity, memory, authority, workflow state, or source of truth.

The production invariant is:

```text
N0 deterministic conversation/control
        |
N1 Sierra specialists + evidence + tools + policy
        |
N2 Sierra Native Semantic Runtime (replaceable private inference)
        |
optional N3 external accelerator (never a liveness dependency)
```

## Research conclusions incorporated into the design

Modern local-serving stacks now converge on several useful primitives: OpenAI-compatible HTTP surfaces, streaming, constrained/structured generation, prompt/KV caching, continuous batching, and optional speculative decoding. llama.cpp provides an OpenAI-compatible local server, parallel decoding, prompt caching, grammar/JSON-schema constrained generation, and speculative decoding. vLLM provides an OpenAI-compatible server and structured-output backends suited to high-throughput GPU serving. ONNX Runtime GenAI provides local generative inference across CPU/CUDA/DirectML and exposes structured-output/tool-calling support.

Those capabilities are adapters, not trusted security boundaries. Structured output must be revalidated by Sierra after inference. A serving engine can regress, ignore a constraint, or change schema behavior; therefore N2 rejects malformed JSON, unknown fields, authority requests, oversized output, redirects, and unexpected content types on the client side.

## Architectural rules

1. **Sierra owns the contract, not the model.** Business code imports the N2 contract, never llama.cpp/vLLM/ONNX/MLX-specific APIs.
2. **Reasoning has zero action authority.** N2 can draft and reason only. Tool execution remains in existing governed Sierra paths.
3. **Native first.** A healthy N2 result is authoritative for semantic drafting. External inference is optional shadow/acceleration and cannot replace a valid native result.
4. **Fail bounded, not provider-shaped.** Provider billing, quota, or outage errors must never become Georgie's user-facing terminal state.
5. **Loopback by default.** N2 defaults to a loopback endpoint. Remote inference requires explicit enablement and TLS.
6. **No redirect following.** Prevent endpoint confusion and accidental credential forwarding.
7. **Client-side schema enforcement.** Never trust server-side constrained generation by itself.
8. **Circuit break repeated failures.** Avoid hot retry loops against an unhealthy local engine.
9. **No secrets in prompts.** The N2 adapter receives already-governed context, not raw credentials.
10. **Measured promotion only.** No engine/model is promoted because it is newer or larger. It must beat the current baseline on held-out Sierra tasks without weakening safety, reliability, or latency.

## Engine strategy

### llama.cpp adapter
Best first portability target for workstation/CPU/Apple/consumer-GPU deployments and constrained single-node operation. Use the OpenAI-compatible chat endpoint. Enable only measured optimizations: prompt cache, parallel slots/continuous batching, and speculative decoding when benchmark evidence proves a net gain.

### vLLM adapter
Preferred candidate for dedicated Linux GPU serving where concurrency/throughput matters. Deploy behind Sierra's own authenticated reverse proxy/network boundary; do not assume the server's API-key flag secures every endpoint.

### ONNX Runtime adapter
Useful for Windows/DirectML/CUDA or hardware-specific deployments where ONNX Runtime provides the strongest supported execution provider. Wrap its native API behind the same Sierra N2 HTTP contract rather than leaking ONNX-specific calls into Georgie.

### MLX/Apple adapter
Candidate only on Apple Silicon hardware after profiling. It must implement the same N2 contract and pass the same corpus; it receives no special authority because it is local.

## Sealed benchmark protocol

The held-out corpus must not be committed beside implementation prompts. Set `SIERRA_NATIVE_SEALED_CORPUS_PATH` to an access-controlled JSON file. The benchmark reads it at runtime, records only its SHA-256 hash and aggregate metrics, and does not print the prompt text.

Minimum release gates:

- sufficient case count (default 40; production target should be materially larger),
- >=95% task-contract pass rate initially,
- zero authority escalation,
- zero structured-output fail-open events,
- bounded p95 response latency,
- explicit provider-outage test,
- prompt-injection/adversarial subset,
- regression comparison against the currently promoted runtime,
- no production promotion until the exact model artifact, quantization, engine version, prompt contract, and benchmark corpus hash are recorded together.

## Benchmark case format

```json
{
  "id": "opaque-case-id",
  "input": "held-out prompt",
  "history": [],
  "context": "verified context",
  "required": ["required phrase or fact"],
  "forbidden": ["forbidden completion claim"],
  "expectNeedsCurrentEvidence": false
}
```

The repository runner intentionally outputs failure IDs and counts, not hidden prompt text.

## Production promotion sequence

1. Compile/install one candidate engine on the actual target hardware.
2. Bind only loopback/private transport.
3. Pin exact engine + model artifact hashes.
4. Run warmup and hardware profiling.
5. Run sealed corpus and adversarial corpus.
6. Run complete external-provider outage tests.
7. Shadow N2 beside the current semantic route without user-visible replacement.
8. Compare latency, correctness, safety, and user feedback.
9. Promote N2 only after gates pass.
10. Keep immediate rollback to N0/N1 bounded behavior.

## What this does not do

This layer does not alter Prism, underwriting, Capital Match, rehash, CRM, approval policy, idempotency, source authority, or evidence contracts. It also does not claim a model is state of the art until measured Sierra-specific evidence proves it.
