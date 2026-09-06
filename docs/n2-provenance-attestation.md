# N2 provenance and runtime configuration attestation

N2 qualification must prove more than artifact hashes. It must establish where the engine/model/tokenizer came from, which revisions and dependencies were resolved, and the exact inference configuration under which evidence was produced.

This attestation is intentionally modeled after modern software-supply-chain provenance principles: origin, resolved dependencies, builder identity, and external parameters are explicit and deterministic. It is not itself a signature service; it produces stable SHA-256 identities that can later be signed or stored in an immutable receipt system.

## Qualification identity

The attestation binds:

- builder identity and builder revision;
- engine name, source, revision, and artifact SHA-256;
- model source, revision, artifact SHA-256, and quantization;
- tokenizer revision and deterministic bundle SHA-256;
- resolved dependency source/revision/artifact SHA-256 values;
- context window and concurrency;
- sampling configuration and seed;
- prompt/KV cache state;
- speculative decoding state;
- continuous batching state;
- structured-output state and schema SHA-256.

Any change to these fields creates a new provenance or runtime-configuration identity and therefore invalidates prior qualification evidence unless the qualification protocol explicitly demonstrates equivalence.

## Why runtime configuration is separate

Model bytes can remain identical while behavior, memory pressure, latency, and determinism change because prompt caching, speculative decoding, batching, sampling, context length, concurrency, or structured-output constraints changed. The runtime configuration receives an independent SHA-256 so operational drift can be detected without pretending the model artifact itself changed.

## Security boundary

The inference engine remains non-authoritative. Provenance does not grant tool access, production authority, or promotion. It is evidence consumed by Sierra's deterministic qualification and promotion layers.

## Fail-closed rules

Qualification is invalid when any pinned engine/model/tokenizer identity differs, the runtime configuration hash differs from the expected qualification configuration, required resolved dependencies are missing, or malformed hashes/configuration values are supplied.
