# Financing recovery vertical slice

## Verified current-state boundaries

Repository inspection establishes these boundaries rather than inferring them from names:

* Sierra workforce RPCs are the canonical CRM/deal read boundary. Sierra correspondence RPCs resolve exact deals, ingest NEO replies and attachments, record outbound receipts, and independently read correspondence back.
* Supabase/PostgreSQL is the existing durable service-role control plane. Recovery intake, suppressions, replies, outbox intents, leases, receipts, and audit evidence therefore live in one transactional schema.
* NEO SMTP/IMAP is the configured transactional correspondence provider. `sendMessage` already uses the governed outbound boundary with a deterministic idempotency key, durable attempted/sent/failed audit, concurrent singleflight, and uncertain-state quarantine. Smartlead is used for campaign inventory and a separate reply-closer authority; it is not treated as transactional recovery-send authority.
* Document intelligence and Sierra correspondence already classify and persist applications and bank statements. The recovery handler accepts their verified metadata; it does not fabricate extraction results.
* No callable, receipt-bearing Prism or Capital Match submission contract exists in this repository. The worker therefore requires the versioned `georgie.prism-handoff.v1` adapter and persists a blocked failure when it is absent. It never reports a handoff as complete without a downstream receipt and verified read-back.

## Implemented contracts

`POST /api/financing-recovery/intake` accepts a completed integrity-verified CM-100 or a historical candidate through a dedicated 32-character-minimum shared-secret boundary. Both lanes require consent evidence, source evidence, and proof that Sierra resolved exactly one canonical deal. Raw/original applications are rejected before storage and this service has no CRM-create operation.

The intake RPC atomically upserts the canonical recovery projection and inserts one unique outbox intent. Deterministic applicant/deal/thread identities converge duplicate deliveries. Verified current statement months bypass outreach and create the Prism intent directly; NY/CA require four prior months and other jurisdictions require three.

`POST /api/financing-recovery/reply` requires the exact provider message, thread, and deal identity. Its RPC inserts the immutable reply audit and downstream outbox intent in one transaction. Unique reply and intent keys collapse replay and concurrency to one durable intent. PostgreSQL `FOR UPDATE SKIP LOCKED`, expiring leases, and fenced completion ensure one effective worker execution.

NEO inbound correspondence now derives only suppression evidence actually visible in repository data: explicit opt-out, complaint, dispute, invalid-recipient, and bounce language. Provider webhook feeds for Smartlead complaints/bounces are **not** claimed connected. Duplicate and active-deal suppression events are accepted only from authenticated evidence producers with stable source event and evidence IDs.

Every NEO success persists provider message ID, accepted and rejected recipients, plus Sierra correspondence read-back. Missing or rejected recipients and missing Sierra verification are exact failures. Sending remains held unless `GEORGIE_FINANCING_OUTREACH_RELEASE=canary`.

## Runtime ownership

Render defines one long-lived `npm start` web service. Its runtime owns the core kernel and a narrow allowlist of authoritative always-on specialists: the existing Smartlead reply closer and financing recovery. The general specialist scheduler remains disabled in kernel mode. Registry invariants and startup tests prove there is one financing-recovery authority and no direct second scheduler.

## External blockers and smallest next actions

1. **Sierra intake producer:** the external Sierra/Supabase service must call the authenticated recovery intake endpoint only after its existing canonical-deal read-back succeeds. Smallest action: send one staff-owned synthetic CM-100 event with application, consent, and canonical-deal evidence IDs while release is held.
2. **Prism:** its owning service must implement `georgie.prism-handoff.v1` (`dealId`, `idempotencyKey`, evidence IDs in; stable `receiptId` and `{readBack:{verified:true}}` out) and persist the same idempotency key. Smallest action: contract-test one synthetic fully documented deal without lender submission.
3. **Capital Match:** its owning service must publish a separate versioned result contract preserving Prism evidence IDs/confidence and a durable read-back receipt. Smallest action: agree the schema and add consumer contract tests; no endpoint is invented here.
4. **Provider suppression webhooks:** configure authenticated Smartlead/NEO provider webhook ingestion only when their signed payload contracts are available. Smallest action: capture and document one vendor-signed synthetic bounce and complaint payload, then add signature and replay tests.
5. **Metrics:** add read-only projections for recovered statement packages, qualified opportunities, underwriting, offers, calls, funded deals/dollars, revenue, reply/opt-out/complaint/bounce rates, and cost per recovered applicant. Smallest action: map each metric to an authoritative audit/result event before dashboard work.

The live canary remains one staff-owned synthetic identity, explicitly allowlisted outside this code, with release held through intake and suppression verification. Temporarily set `canary`, verify exactly one NEO receipt and Sierra read-back, ingest one synthetic attachment reply, verify one Prism intent, then return to hold. Do not load historical inventory or enable unrestricted outreach.
