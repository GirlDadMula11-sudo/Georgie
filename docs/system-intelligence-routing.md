# Sierra System Intelligence Routing

Georgie is the central intelligence governor for Georgie and Sierra CRM processing. Sierra callers declare the work's requirements; they do not select a model directly.

## Source order

1. Deterministic code and authoritative provider/database evidence.
2. Fresh cached evidence that satisfies the required coverage.
3. A configured local model for bounded private/offline work.
4. GPT-5.6 Luna for routine, high-volume, low-uncertainty processing.
5. GPT-5.6 Terra for operational judgment, synthesis, and ordinary Sierra exceptions.
6. GPT-5.6 Sol for material financial, underwriting, production, security, architectural, or conflicting-evidence decisions.

The cheapest source is used only when it meets the task's minimum intelligence requirement. Cost pressure must never silently turn a Sol-level conclusion into a Luna-level conclusion. When the minimum tier is unavailable, Georgie may triage, collect evidence, or queue work, but it cannot claim the final conclusion.

## Request contract

Sierra work should provide an objective and, when known: domain, risk, uncertainty, business impact, whether judgment is required, current-evidence requirements, deterministic availability, cache freshness, evidence coverage, and minimum tier. Georgie returns the selected source, model tier, reasoning effort, spend class, selection reasons, evidence requirements, and conclusion authority.

## Governance

- Balanced and frontier inference remain explicit runtime capabilities.
- Deterministic and cached results are preferred before model spend.
- Every decision exposes why the tier was selected and whether it meets the minimum.
- High-impact downgraded work is restricted to triage and evidence collection.
- Provider credentials, budgets, approval gates, and kill switches remain separate from intelligence selection.
- Sierra must not embed an OpenAI credential or independently bypass Georgie's governor.

## Required production evidence

- Unit tests prove Luna, Terra, Sol, zero-spend cache, and unsafe-downgrade behavior.
- Runtime readiness proves the engineering coordinator is active when durable assistant handoffs are advertised.
- A live handshake imports GitHub issue #256 and posts an idempotent receipt.
- Model usage and outcome telemetry are retained before raising automatic spending limits.
