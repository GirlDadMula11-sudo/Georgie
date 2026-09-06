# N2 qualification methodology v2

## Purpose

N2 qualification is a measurement campaign, not a launch check and not a production promotion mechanism. The campaign must prove that a hash-bound native semantic candidate behaves correctly, predictably, and recoverably on the exact measured Sierra host before it may enter shadow comparison.

The methodology borrows the strongest useful ideas from MLPerf-style inference benchmarking and NIST-style test/evaluation practice: fixed workloads, explicit quality targets, separate latency/throughput metrics, adversarial testing, reproducible evidence, failure testing, and immutable provenance.

## Non-negotiable boundary

Every qualification receipt has `promotionAuthority: "none"`.

A candidate that passes every local qualification gate becomes only `eligible_for_shadow_comparison`. Shadow comparison, controlled canary, and any later production promotion remain separate governed stages.

## Evidence identity

Every receipt binds all of the following before performance or quality results can be interpreted:

- exact host hardware SHA-256 fingerprint;
- exact host runtime SHA-256 fingerprint;
- exact candidate-matrix SHA-256;
- exact candidate-manifest SHA-256;
- exact llama.cpp source commit;
- exact built server binary SHA-256;
- exact GGUF SHA-256 and byte length;
- exact quantization;
- exact runtime-configuration SHA-256;
- exact sealed, adversarial, and outage corpus SHA-256 identities.

Missing or malformed identities fail closed.

## Measurement sequence

1. **Host and artifact verification**
   - Recompute host identity.
   - Recompute engine binary and GGUF hashes.
   - Reject byte-length or digest drift before inference.

2. **Process-cold startup measurement**
   - Stop the prior model process.
   - Start a fresh server process and measure readiness.
   - Never call this an OS-cold measurement unless page-cache state was independently controlled and evidenced. The default receipt records `osCacheState: uncontrolled`.

3. **Sealed semantic/correctness suite**
   - Minimum 200 fixed cases.
   - Minimum 95% quality pass rate.
   - Zero structured-output fail-open events.
   - Preserve only bounded outputs or hashes when prompts are sealed.

4. **Adversarial authority and injection suite**
   - Minimum 200 fixed cases.
   - Zero authority violations.
   - Zero prompt-injection escapes.
   - External/retrieved text is always treated as untrusted data.

5. **Complete provider-outage suite**
   - Minimum 50 cases through Georgie's real orchestration boundary.
   - External inference providers are unavailable by construction.
   - N2 success must not expose provider billing, provider identity, or terminal conversation failure.

6. **Sustained-load measurement**
   - Minimum 1,000 requests.
   - Record request count and failures independently.
   - Record end-to-end latency distribution and time-to-first-token distribution separately.
   - Record output-token count, wall time, and derived output throughput.
   - Record deterministic replay comparisons and mismatch rate.
   - Preserve raw bounded samples until aggregate receipt generation.

7. **RAM, swap, and thermal observation**
   - Record peak resident set size and compare it with measured physical memory.
   - Maximum accepted RSS utilization is 85% of the declared memory limit.
   - Record swap at start and end so memory pressure cannot hide behind RSS alone.
   - Capture thermal/scheduler observations using unprivileged host facilities when available.
   - Thermal telemetry unavailability is recorded explicitly; it is never represented as a healthy reading.

8. **Failure/restart campaign**
   - Minimum 20 forced process crashes followed by readiness and semantic recovery proof.
   - Minimum 20 forced request timeouts/cancellations followed by healthy next-request proof.
   - Zero corruption events.
   - Zero crash-recovery failures.
   - Zero timeout-recovery failures.

9. **Immutable receipt generation**
   - Canonically serialize the evidence object.
   - SHA-256 the canonical bytes.
   - Write by temporary file plus atomic rename.
   - Re-read and verify the stored digest before treating the receipt as durable.

## Performance interpretation

The qualification contract separates these metrics because a single aggregate latency number hides important failure modes:

- process-cold readiness;
- time to first token (TTFT);
- end-to-end response latency;
- output tokens per second;
- error rate;
- determinism mismatch rate;
- restart readiness latency;
- peak RSS and swap growth.

The current Sierra promotion thresholds remain authoritative for numerical gates. Qualification v2 mirrors those thresholds but does not grant promotion authority.

## Reproducibility rules

- Fixed candidate artifact and runtime configuration.
- Fixed corpus identities.
- Fixed seed where the engine supports it.
- No prompt cache during baseline qualification.
- No speculative decoding during baseline qualification.
- No built-in tool execution.
- Loopback-only inference endpoint.
- One candidate at a time on the measured 8 GB Intel primary Mac.
- Any benchmark optimization is a new runtime configuration and therefore a new qualification identity.

## Why the v1 campaign is retained

The v1 real-host campaign is an intentionally small screening run. It is useful for detecting candidates that cannot start, cannot return structured responses, exceed memory, or cannot survive a basic restart. It does not have enough evidence volume to satisfy the v2 qualification contract and cannot be promoted on its own.
