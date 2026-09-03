# Financing recovery architecture

## Authoritative lane rules

Historical **rehash** inventory is a contact-recovery lane, not an underwriting eligibility lane. Every imported record with a resolved canonical identity and verified consent remains eligible for governed outreach unless the global suppression/cadence system blocks it. Expected return changes queue order only; it never excludes a valid rehash. Historical rehashes request exactly the two most recent complete business bank-statement months not already present and verified, regardless of jurisdiction.

New completed, integrity-verified CM-100 applications remain a separate lane. They use only authoritative product requirements supplied with the canonical application event. Raw/original applications are rejected, and this subsystem has no CRM deal-creation operation.

## Proven repository boundaries

Sierra workforce and correspondence RPCs are the canonical deal, document, inbound attachment, outbound correspondence, and independent read-back boundaries. Supabase/PostgreSQL is the durable service-role control plane. NEO SMTP/IMAP is the configured transactional email provider; its governed send already provides deterministic idempotency, singleflight, durable attempted/sent/failed evidence, and uncertain-state quarantine. Smartlead remains campaign/reply infrastructure and is not represented as the transactional rehash sender.

The provider-neutral `georgie.recovery-evidence-connector.v1` contract permits an authorized folder, object store, or export connector to list/read files without assuming a vendor. Existing attachment signature/type/size validation is reused. Every object is SHA-256 addressed before extraction; duplicate hashes collapse, and ambiguous identity/classification is quarantined. Extraction returns application/statement type, month, bank, account ending, business identity, confidence, and evidence IDs. No source file must already exist in CRM or email.

## Prism before contact

Historical intake creates one `prism_precontact` intent keyed by the sorted evidence version. The deterministic `georgie.prism-precontact.v1` packet exposes only business/contact identity, verified historical months, summarized revenue/cash flow, prior positions/funding evidence, two missing months, confidence/evidence IDs, and safe cues. It excludes raw transactions and any invented offer, approval, rate, or amount. Low/missing confidence produces `generic_factual` personalization. Packet completion, secure-token issuance, and creation of the one downstream outreach intent are durable and replay-safe; unchanged evidence cannot repeat Prism work.

## Secure two-slot upload

Upload tokens are 256-bit opaque values; only SHA-256 hashes are stored in the token table. They are applicant/episode/two-month scoped, expire within fourteen days, and can be revoked with evidence. Completion reuses file signature/type/20-MB checks and additionally requires a clean malware-scan receipt plus document-month and business-identity validation. Content hash, token, month, and completion keys prevent duplicate documents or slots. Only after both distinct requested months are verified does one unique `crm.canonical_documents_ready` event become visible. That event explicitly says no new application is required; it does not create another deal. Partial-completion copy requests only the remaining month and repeats that no application is needed.

## Georgie closer and omnichannel state

Georgie owns initial outreach, collection, status, objections, verified-offer explanation, negotiation inside configured guardrails, and funding coordination. Humans are exception-only for authority-exceeding binding commitments, ambiguity, compliance risk, or an explicit client request.

Email and future programmable SMS share applicant/deal/episode identity, suppression, cadence, step state, receipts, and stop conditions. A unique `(episode, step)` database constraint prevents redundant same-step email/SMS messages. `georgie.sms.v1` requires a configured provider, programmable number, registration proof, signed webhook verification, provider event IDs, replay-safe receipts, and STOP/HELP handling. TextFree is not automated and no SMS provider or number is claimed live.

Templates are deterministic and brief. They name the exact two months, state Sierra already has the application information, state no new application is needed, use only safe Prism cues, provide the secure link, and make no approval, amount, rate, lender-interest, or funding promise.

## Economics and truthful readiness

Deterministic hashing, matching gates, templates, cadence, upload validation, and routing use no model. Model policy remains Luna → Terra → Sol with pair tiers disabled. Document/OCR work keys on content hash and Prism work keys on evidence version. Per-rehash economics expose email, SMS, model, and document-processing cost alongside recovered packages, funded deals/dollars, and revenue.

`georgie.financing-recovery-readiness.v1` independently reports durable storage, evidence connector, Prism packet integration, secure upload, canonical CRM gate, dedicated Georgie email, SMS provider/number/registration, webhook verification, closer authority, omnichannel suppression, and outreach hold. Missing adapters stay red.

## External blockers and smallest next actions

1. **Evidence vault connector:** implement `georgie.recovery-evidence-connector.v1` in the service that owns the authorized export/folder/object store. Verify one synthetic application and two statements, including duplicate and ambiguous fixtures.
2. **Sierra producer:** call authenticated historical/new intake only after canonical deal and consent read-back. Send one staff-owned synthetic historical record while outreach is held.
3. **Malware scanner/document validator:** bind the secure-upload hooks to approved scanning and Sierra extraction services and return stable receipts/evidence IDs. Validate one harmless synthetic PDF in each slot.
4. **Prism/Capital Match:** the external owners must implement receipt-bearing, idempotent contracts. Prism must read the pre-contact packet; Capital Match must preserve Prism evidence IDs/confidence. Contract-test synthetic data before any lender action.
5. **SMS:** select a programmable provider/number, complete registration, and implement signed webhook verification. Test synthetic STOP/HELP/delivery events; do not purchase or port from this repository.
6. **Metrics projection:** project recovery audit/channel/outcome records into the requested outcome dashboard without using send volume as the objective.

The smallest safe canary remains one staff-owned synthetic rehash. Keep release held through evidence import, generic/verified Prism packet inspection, token/upload replay tests, suppression checks, and Sierra read-back. No production outreach, migration application, file transmission, number purchase, deployment, or external submission is part of this change.

## Client portal

`/recovery/` is a mobile-first Sierra Capital Funding document journey with safe business/client personalization, Georgie identity, secure-session and expiry state, two exact month cards, drag/drop and native mobile file selection, per-file transfer/scan/validation feedback, partial progress, precise recovery messages, privacy explanation, support, and a restrained completion sequence for Prism review, possible funding-option evaluation, and Georgie follow-up. Raw tokens are removed from browser history immediately and are never rendered; public session data excludes internal applicant/deal/thread IDs and banking details.

The repository contains authoritative Georgie artwork but no Sierra/SM logo file. The portal therefore uses a typographic Sierra wordmark and does **not** misrepresent the Georgie mark or a fabricated image as Sierra’s logo. Smallest next action: the Sierra brand owner must add the approved transparent SM asset to `public/`; only then should the wordmark be replaced, with an asset provenance review and visual regression approval.
