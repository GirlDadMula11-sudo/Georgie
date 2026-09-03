# Financing recovery vertical slice

## Current-state assessment

The canonical application/document boundary is Sierra's governed evidence and document-intelligence layer. It already distinguishes applications and bank statements, but no repository code proves a live intake webhook or CRM writer. The CM-100 rule therefore remains an explicit input precondition: only a completed, integrity-verified CM-100 may enter the new lane, and this slice never writes a raw application or a second CRM deal.

Supabase is the established durable control plane and fail-closed readiness dependency. Neo SMTP is the transactional correspondence provider; Smartlead code is campaign inventory/reply infrastructure and is not assumed to be the send authority. Prism and Capital Match are evidenced concepts and downstream boundaries, but no verified callable contract exists in this repository. This slice consequently emits a durable, idempotent `prism_wakeup` intent and does not pretend to submit it. A production adapter must preserve evidence IDs, confidence, and a read-back receipt before enabling that handoff.

## Implemented boundary

Both lanes normalize applicant/deal/thread IDs, calculate the exact prior three statement months (four for NY/CA), reuse verified current documents, and transact a unique statement-request or Prism intent. A single suppression system and attempt cap gate every send. Claims use PostgreSQL row locks, leases, and unique idempotency keys. Terminal send state requires a Neo provider message ID. Replies require exact provider/thread/deal identity and deterministically choose acknowledgement, Prism, or closer intents.

Sending defaults to `hold`; `GEORGIE_FINANCING_OUTREACH_RELEASE=canary` is required. Model policy is Luna-first, Terra escalation, Sol complex/high-risk, with pair tiers disabled; statement math, identity, suppression, and routing are deterministic.

## Remaining contracts and smallest canary

Before production: deploy the migration; implement the authoritative Sierra intake transaction/RPC and verified reply attachment adapter; certify CRM single-deal read-back; implement Prism and Capital Match adapters with schema/version, evidence IDs/confidence, idempotency, receipts, and failure persistence; connect delivery/bounce/complaint webhooks; and expose outcome metrics (packages, qualified opportunities, underwriting, offers, calls, funding/revenue, reply/opt-out/complaint/bounce rates, and cost per recovery).

The smallest safe canary is one staff-owned synthetic completed CM-100 with a unique email, explicit consent evidence, no suppressions, and known statement fixtures. Keep the worker enabled but release held, verify candidate/intent/audit rows and suppression behavior, then set `canary` for only that allowlisted identity, verify the exact Neo receipt, ingest one synthetic reply, verify a single Prism wakeup, and return to hold. Do not load historical inventory or enable unrestricted outreach.
