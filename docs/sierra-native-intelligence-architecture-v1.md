# Sierra Native Intelligence Architecture v1

## Objective

Georgie must remain conversationally alive, state-aware, policy-governed, and operational when every external model provider is unavailable. External inference is an optional accelerator, never the identity, memory, authority, execution, or completion layer.

## Proven mismatch corrected by this slice

The runtime already had durable state, deterministic fast paths, governed tools, evidence contracts, model-cost fencing, and provider-independent architecture language. However, ordinary conversational turns still fell through to the provider-backed reasoning path. A provider billing failure therefore surfaced as if Georgie itself were unavailable.

This slice establishes a Sierra-native conversational kernel ahead of that path and makes the native-first hierarchy a runtime-baseline invariant.

## Native hierarchy

1. **Tier N0 — deterministic conversation and control**
   - greetings, acknowledgements, identity, capability, continuity
   - zero network dependency
   - bounded deterministic latency
   - never reports provider billing state to the user as Georgie's state

2. **Tier N1 — deterministic Sierra operating intelligence**
   - policy, idempotency, evidence gates, state machines, workflow semantics
   - Prism, underwriting, CapitalMatch and domain-specific native engines remain independent specialists
   - factual claims require source evidence where appropriate

3. **Tier N2 — Sierra-owned local semantic inference**
   - interchangeable self-hosted inference adapter
   - preferred serving contract: local/private HTTP with streaming + structured output
   - no provider-specific business logic
   - model artifacts are replaceable and benchmarked rather than identity-bearing

4. **Tier N3 — optional external accelerator**
   - opt-in only
   - never owns memory, policy, tool authority, completion truth, or user identity
   - failure must degrade capability, not terminate Georgie

## Research findings applied

Current local inference stacks support the architecture without binding Georgie to a hosted inference API. llama.cpp provides a local/server inference runtime with an OpenAI-compatible HTTP surface, wide hardware support, quantization, streaming and structured output. ONNX Runtime GenAI provides another replaceable local inference path with tokenization, generation loops, KV cache management and structured output/tool-calling support. The adapter contract should therefore be Sierra-owned while the underlying runtime remains replaceable.

Apple-specific acceleration such as Metal/MLX may be attached where hardware supports it, but Georgie's contract must not assume Apple Silicon because the operating fleet can include older Intel Macs, cloud hosts and future hardware.

## Efficiency rules

- never invoke semantic inference for a deterministic conversational turn;
- never perform web/current-state reads when the request does not require freshness;
- perform independent safe reads concurrently;
- cache immutable/canonical evidence by content fingerprint;
- make state transitions idempotent and receipt-backed;
- use specialized native engines before general-purpose inference;
- load model capacity only when uncertainty/value justifies it;
- keep provider/model telemetry out of ordinary user-facing conversation;
- measure first-token latency, tokens/sec, memory pressure, energy, cost, abstention quality and verified task outcome separately.

## Hard release gates for N2 local semantic inference

A local model/runtime cannot be promoted because it is fashionable or because it answers demos well. Promotion requires:

1. deterministic native conversation remains green with inference completely offline;
2. exact structured-output schema compliance;
3. prompt-injection tests proving external content cannot expand tool authority;
4. measured answer quality on Georgie's sealed evaluation corpus;
5. hallucination/abstention comparison against the current reference path;
6. sustained-load latency and memory profiling on actual Sierra hardware;
7. restart/crash isolation so model failure cannot take down the core runtime;
8. signed/versioned model manifest and content hash;
9. no secrets in prompts or model artifacts;
10. rollback to the preceding native runtime without data migration.

## Non-goals

- No claim that a locally hosted model is universally superior to every model in existence.
- No weakening of current governance, approval, security, evidence, memory, Prism, underwriting, CapitalMatch, rehash, or operational reliability controls.
- No production deployment merely because CI passes.

The competitive objective is measurable: Georgie should become better for Sierra's actual workloads by combining proprietary operating state, native specialists, durable memory, deterministic policy, verified outcomes, and replaceable inference more efficiently than a generic standalone assistant.
