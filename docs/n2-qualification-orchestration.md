# Sierra N2 qualification orchestration

The qualification orchestrator exists to prevent a candidate from being promoted on evidence that was produced for a different host, model artifact, sealed corpus, provenance chain, or runtime configuration.

## Trust model

The semantic model is never an authority boundary. External or retrieved content is untrusted data. Tool authority, policy, approval, and rollback remain deterministic Sierra controls outside N2.

## Required binding

A qualification run must bind all evidence to:

- the promotion-grade host hardware fingerprint;
- the exact candidate manifest SHA-256 (engine, model, quantization, tokenizer, artifact hashes, hardware);
- the exact provenance SHA-256 (builder, engine/model origin, tokenizer identity, resolved dependencies);
- the exact runtime-configuration SHA-256;
- the sealed corpus SHA-256;
- the deterministic candidate-planner decision;
- the promotion decision fingerprint;
- the Sierra-native rollback target.

Evidence from another host, candidate manifest, provenance chain, runtime configuration, or sealed corpus is rejected before promotion scoring.

## Runtime configuration is qualification identity

The runtime configuration is part of what was tested, not an operational afterthought. Its identity includes context window, concurrency, temperature, top-p, seed, prompt-cache state, speculative-decoding state, continuous batching, structured-output state, and structured-output schema hash.

If any of those values change, prior qualification evidence is stale and cannot be reused.

## Execution sequence

1. Collect the real host profile on the machine that will serve N2.
2. Run the fail-closed capacity planner.
3. Select only a candidate admitted for qualification.
4. Pin engine/model/tokenizer artifacts cryptographically.
5. Generate and validate provenance for the exact builder, dependencies, tokenizer bundle, and runtime configuration.
6. Prove the runtime context and concurrency match the admitted planner candidate.
7. Produce sealed, adversarial, outage, stress/crash/timeout, and shadow evidence under that exact provenance/runtime identity.
8. Bind every evidence record to candidate manifest, host, provenance, and runtime-configuration hashes.
9. Verify sealed-corpus identity.
10. Evaluate the N2 promotion gates.
11. Emit a deterministic qualification receipt.
12. Permit at most a controlled canary. Production authority remains a separate explicit release decision.

## Optimization rule

Prompt/KV caching, speculative decoding, batching, sampling, seed changes, structured-output schema changes, quantization, context-window changes, engine revision changes, tokenizer changes, dependency changes, or hardware changes invalidate prior qualification unless the corresponding provenance/runtime identity and evidence are regenerated.

Performance optimizations are never allowed to inherit a prior pass merely because the model bytes are unchanged.

## Failure posture

Any missing binding, malformed SHA-256, mismatched host, candidate, provenance, runtime configuration, corpus, planner rejection, or incomplete promotion evidence fails closed before canary eligibility can be produced.

The safe terminal state remains `remain_on_sierra_native_control`.
