# AI Control Transport Resilience

## Purpose

Make ChatGPT↔Georgie coordination fail closed, durable, and recoverable when the direct connector is unavailable, without weakening approval, idempotency, lease, or secret-redaction controls.

## Failure class

The direct ChatGPT-side Georgie tool can be unavailable or disabled before a command reaches Georgie. This is a transport-registration failure, not a Georgie runtime failure and not a provider failure.

## Required behavior

1. Expose a machine-readable connector health contract that distinguishes `available`, `degraded`, and `unavailable` and reports protocol/schema version, capability-registry hash, last successful admission time, and last receipt read-back time without exposing credentials.
2. Treat direct-connector unavailability as `CONNECTOR_UNAVAILABLE`, never as command rejection, provider failure, or missing approval.
3. Preserve the same objectiveId, correlationId, mutationScope, and idempotencyKey across transport fallback/retry.
4. Permit trusted GitHub `georgie-handoff` AIControlEnvelope v1 messages to act as a transport fallback for command delivery, but never as approval authority. Approval must be referenced by immutable approvalRef/planId/approvalId created by an authenticated approval channel.
5. Maintain one owner per mutation scope. A direct-connector retry and GitHub fallback for the same logical command must collapse to one durable command identity and one mutation lease.
6. Return native Georgie receipts through the durable GitHub receipt outbox and confirm delivery only after marker read-back.
7. Add bounded retry/backoff and dead-letter quarantine for transport failures. Do not create a new mutation identity during retry.
8. Add startup/deploy canaries: connector health, one read-only command admission, durable command ID, receipt persistence, GitHub read-back, and exact duplicate replay proving no second execution or receipt.
9. Block full control-plane certification when any canary leg is absent.
10. Never place tokens, passwords, cookies, private keys, or invite tokens in GitHub or model-visible evidence.

## Acceptance tests

- Direct connector unavailable before admission -> machine-readable `CONNECTOR_UNAVAILABLE`; no Georgie/provider failure is recorded.
- Same logical command delivered by direct transport and GitHub fallback -> one command, one lease, one execution.
- GitHub fallback command with no approval reference cannot perform an external write.
- Existing immutable approval reference survives transport outage and can be forwarded after recovery without asking the human to approve again.
- Receipt POST succeeds but response is lost -> read-before-write/read-back prevents duplicate comment.
- Registry/schema hash mismatch -> quarantine with supported versions/capabilities, no execution.
- Deploy canary proves dispatch -> durable command ID -> execution -> receipt -> read-back -> duplicate replay suppression.

## Operational target

Use this resilience layer to complete `louri-supabase-onboarding` without Jason relaying routine messages, while preserving the exact Supabase membership mutation scope and existing approval boundary.
