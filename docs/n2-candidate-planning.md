# N2 candidate planning

This stage runs only after a promotion-grade `sierra.native-semantic-host-profile.v2` has been captured on the real host.

## Purpose

The planner is a safety prefilter, not a model-quality judge. It decides whether a candidate is safe enough to enter the expensive qualification campaign. It must never infer missing memory measurements optimistically.

Each candidate declares:

- engine and model identity label;
- quantization;
- model artifact bytes;
- measured or vendor-derived runtime overhead bytes;
- KV-cache bytes per token per concurrent sequence for the exact engine/model/quantization configuration;
- extra working-set bytes;
- requested context window;
- maximum concurrent sequences.

The planner then checks engine/host compatibility, context capacity, concurrency capacity, and worst-case declared memory against a conservative host budget.

## Memory policy

Default admission budget is 75% of physical/unified host memory. The caller may lower it. The planner refuses values above 80% so candidate selection cannot erase operating-system and runtime headroom before stress testing begins.

This prefilter is intentionally stricter than the later measured stress gate. Passing planning means only `admitted_for_qualification`; it does not mean the candidate is production safe.

## Engine compatibility in v1

- `mlx-lm`: Apple silicon (`darwin` + `arm64`).
- `vllm`: Linux host with an NVIDIA accelerator in the captured profile.
- `llama.cpp`: portable candidate; detailed backend capability is proven during the qualification run.
- `onnx-runtime-genai`: portable candidate; detailed execution-provider capability is proven during the qualification run.

These constraints are conservative. Adding another supported topology requires a tested planner revision rather than a configuration shortcut.

## Next stage

Only admitted candidates may proceed to exact artifact hashing and the sealed qualification campaign:

1. pin engine/model/tokenizer artifacts;
2. sealed quality and structured-output tests;
3. prompt-injection and authority-escalation attacks;
4. complete provider outage;
5. sustained concurrency and memory-pressure testing;
6. forced crash and timeout recovery;
7. deterministic replay;
8. shadow comparison against the incumbent deep route;
9. controlled canary if every promotion gate passes.

A planner decision is canonically serialized and SHA-256 fingerprinted so the candidate set, host identity, requested context/concurrency, and memory policy used for admission are immutable evidence.