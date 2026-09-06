# Sierra N2 qualification orchestration

The qualification orchestrator exists to prevent a candidate from being promoted on evidence that was produced for a different host, model artifact, or sealed corpus.

## Trust model

The semantic model is never an authority boundary. External or retrieved content is untrusted data. Tool authority, policy, approval, and rollback remain deterministic Sierra controls outside N2.

## Required binding

A qualification run must bind all evidence to:

- the promotion-grade host hardware fingerprint;
- the exact candidate manifest SHA-256 (engine, model, quantization, tokenizer, artifact hashes, hardware);
- the sealed corpus SHA-256;
- the deterministic candidate-planner decision;
- the promotion decision fingerprint;
- the Sierra-native rollback target.

Evidence from another host, another candidate manifest, or another sealed corpus is rejected before promotion scoring.

## Execution sequence

1. Collect the real host profile on the machine that will serve N2.
2. Run the fail-closed capacity planner.
3. Select only a candidate admitted for qualification.
4. Pin engine/model/tokenizer artifacts cryptographically.
5. Produce sealed, adversarial, outage, stress/crash/timeout, and shadow evidence on the same pinned host/candidate.
6. Bind every evidence record to the candidate manifest and host fingerprint.
7. Verify sealed-corpus identity.
8. Evaluate the N2 promotion gates.
9. Emit a signed-by-hash qualification receipt.
10. Permit at most a controlled canary. Production authority remains a separate explicit release decision.

## Optimization rule

Prompt/KV caching, speculative decoding, batching, quantization, context-window changes, engine revision changes, tokenizer changes, or hardware changes invalidate prior qualification unless the resulting candidate manifest and evidence are regenerated. Performance optimizations are not allowed to bypass correctness or security qualification.

## Failure posture

Any missing binding, malformed SHA-256, mismatched host, mismatched candidate, mismatched corpus, planner rejection, or incomplete promotion evidence fails closed to `remain_on_sierra_native_control` or throws before a promotion decision can be produced.
