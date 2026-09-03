import test from "node:test";
import assert from "node:assert/strict";
import {
  PRISM_ADAPTER_CONTRACT, ingestRecoveryCandidate, ingestSuppressionEvent, missingStatementMonths,
  processRecoveryIntent, receiveRecoveryReply, requiredStatementMonths, suppressionDecision
} from "../src/financing-recovery.js";
import { suppressionFromCorrespondence } from "../src/recovery-suppression.js";

function intake(lane = "new") {
  return {
    lane, tenantId: "sierra", sourceApplicationId: "cm100-1", email: "Owner@Example.com", firstName: "Ava", jurisdiction: "FL",
    applicationType: "CM-100", integrityVerified: true, completed: true, canonicalDealVerified: true,
    canonicalDealEvidenceId: "crm-readback-1", consentBasis: { verified: true, evidenceId: "consent-1" },
    evidenceIds: ["app-doc-1"], documents: [], authoritativeMissingMonths: ["2026-08", "2026-07", "2026-06"]
  };
}

function durableStore() {
  const candidates = new Map(), intents = new Map(), replies = new Map(), suppressions = new Map();
  return {
    candidates, intents, replies, suppressions,
    async transactIntake(candidate, intent) {
      const prior = candidates.get(candidate.sourceApplicationId);
      if (prior && prior.dealId !== candidate.dealId) throw new Error("CANONICAL_DEAL_CONFLICT");
      candidates.set(candidate.sourceApplicationId, candidate);
      if (!intents.has(intent.key)) intents.set(intent.key, { ...intent, ...candidate });
      return { dealId: candidate.dealId, intentCreated: !prior, intentKind: intent.kind };
    },
    async transactReply(reply) {
      if (replies.has(reply.replyKey)) return { deduplicated: true, intentCreated: false };
      replies.set(reply.replyKey, reply);
      const key = reply.closerKey || reply.prismKey || reply.acknowledgementKey;
      const created = !intents.has(key);
      if (created) intents.set(key, { kind: reply.prismKey ? "prism_wakeup" : reply.closerKey ? "closer_handoff" : "acknowledgement", key, ...reply });
      return { deduplicated: false, intentCreated: created, intentKind: intents.get(key).kind };
    },
    async transactSuppression(event) { const created = !suppressions.has(event.idempotencyKey); suppressions.set(event.idempotencyKey, event); return { created }; }
  };
}

test("historical rehash replay converges on one canonical deal and Prism precontact intent", async () => {
  const store = durableStore(), now = new Date("2026-09-03T00:00:00Z");
  await Promise.all(Array.from({ length: 20 }, (_, index) => ingestRecoveryCandidate(store, intake("historical"), { now })));
  assert.equal(store.candidates.size, 1);
  assert.equal(store.intents.size, 1);
  assert.deepEqual([...store.intents.values()][0].missingMonths, ["2026-08", "2026-07"]);
  assert.equal([...store.candidates.values()][0].rawApplicationCrmWrite, false);
});

test("verified current statements bypass outreach and create one Prism intent", async () => {
  const store = durableStore(), input = intake();
  input.documents = requiredStatementMonths({ asOf: new Date("2026-09-03"), jurisdiction: "FL", lane: "new", authoritativeMissingMonths: input.authoritativeMissingMonths }).map(statementMonth => ({ statementMonth, verified: true }));
  await Promise.all([ingestRecoveryCandidate(store, input, { now: new Date("2026-09-03") }), ingestRecoveryCandidate(store, input, { now: new Date("2026-09-03") })]);
  assert.equal([...store.intents.values()][0].kind, "prism_wakeup");
  assert.equal(store.intents.size, 1);
  assert.deepEqual(missingStatementMonths(requiredStatementMonths({ asOf: new Date("2026-09-03"), jurisdiction: "FL", lane: "new", authoritativeMissingMonths: input.authoritativeMissingMonths }), input.documents), []);
});

test("raw, unverified, noncanonical, and consent-uncertain applications fail closed", async () => {
  const store = durableStore();
  await assert.rejects(() => ingestRecoveryCandidate(store, { ...intake(), rawApplication: true }), /RAW_APPLICATION/);
  await assert.rejects(() => ingestRecoveryCandidate(store, { ...intake(), integrityVerified: false }), /NOT_CANONICAL/);
  await assert.rejects(() => ingestRecoveryCandidate(store, { ...intake(), canonicalDealVerified: false }), /SINGLE_DEAL/);
  await assert.rejects(() => ingestRecoveryCandidate(store, { ...intake(), consentBasis: { verified: false } }), /CONSENT/);
  assert.equal(store.candidates.size, 0);
});

test("release hold and suppression prevent NEO invocation", async () => {
  let sends = 0;
  const intent = { id: "i", key: "k", kind: "statement_request", missingMonths: ["2026-08"], dealId: "d", email: "a@b.com" };
  const held = { checkGlobalSuppression: async () => ({ allowed: true }), holdIntent: async (_intent, reason) => reason };
  assert.equal(await processRecoveryIntent(held, intent, { release: "hold", send: async () => { sends += 1; } }), "RELEASE_HOLD");
  const blocked = { checkGlobalSuppression: async () => ({ allowed: false, reason: "opt_out" }), blockIntent: async (_intent, reason) => reason };
  assert.equal(await processRecoveryIntent(blocked, intent, { release: "canary", send: async () => { sends += 1; } }), "opt_out");
  assert.equal(sends, 0);
});

test("NEO success persists recipients and Sierra read-back; incomplete evidence is failure", async () => {
  const intent = { id: "i", key: "stable-key", kind: "statement_request", missingMonths: ["2026-08"], dealId: "d", threadId: "t", email: "a@b.com" };
  let persisted, failed, sends = 0;
  const store = {
    checkGlobalSuppression: async () => ({ allowed: true }),
    recordProviderReceipt: async (_intent, evidence) => { persisted = evidence; return evidence; },
    recordProviderFailure: async (_intent, error) => { failed = error; }
  };
  const send = async (_user, message) => {
    sends += 1;
    assert.equal(message.idempotencyKey, "stable-key");
    return { receipt: { messageId: "neo-1", accepted: ["a@b.com"], rejected: [] }, sierra: { verification: { ok: true, direction: "outbound", notification_exists: true } } };
  };
  await processRecoveryIntent(store, intent, { release: "canary", send });
  assert.deepEqual(persisted.accepted, ["a@b.com"]);
  assert.equal(persisted.sierraReadBack.ok, true);
  await assert.rejects(() => processRecoveryIntent(store, intent, { release: "canary", send: async () => ({ receipt: { messageId: "neo-2", accepted: [], rejected: ["a@b.com"] } }) }), /CLEAN_PROVIDER/);
  assert.equal(failed, "CLEAN_PROVIDER_RECEIPT_REQUIRED");
  assert.equal(sends, 1);
});

test("duplicate and concurrent replies create one durable Prism intent and one effective wakeup", async () => {
  const store = durableStore(), reply = { providerMessageId: "m1", threadId: "t1", dealId: "d1", complete: true, coverageVersion: "v1", evidenceIds: ["doc-1"] };
  await Promise.all(Array.from({ length: 25 }, () => receiveRecoveryReply(store, reply)));
  assert.equal(store.replies.size, 1);
  assert.equal(store.intents.size, 1);
  const intent = { id: "intent-1", lease_token: "lease-1", ...[...store.intents.values()][0], idempotency_key: [...store.intents.keys()][0] };
  let submissions = 0, receipts = 0;
  const executionStore = { recordDownstreamReceipt: async () => { receipts += 1; }, recordDownstreamFailure: async () => assert.fail("unexpected failure") };
  const prismAdapter = { contract: PRISM_ADAPTER_CONTRACT, submit: async () => { submissions += 1; return { receiptId: "prism-1", readBack: { verified: true } }; } };
  await processRecoveryIntent(executionStore, intent, { prismAdapter });
  assert.equal(submissions, 1);
  assert.equal(receipts, 1);
});

test("missing Prism adapter persists an explicit blocked boundary", async () => {
  let failure;
  await processRecoveryIntent({ recordDownstreamFailure: async (_intent, error) => { failure = error; } }, { kind: "prism_wakeup" });
  assert.equal(failure, "PRISM_ADAPTER_UNAVAILABLE");
});

test("available NEO suppression evidence is normalized and replay-safe", async () => {
  const store = durableStore();
  for (const [text, reason] of [["Please unsubscribe me", "opt_out"], ["I dispute this application", "dispute"], ["Permanent delivery failure", "bounce"]]) {
    const event = suppressionFromCorrespondence({ messageId: `m-${reason}`, from: "owner@example.com", text });
    assert.equal(event.reason, reason);
    const first = await ingestSuppressionEvent(store, event), replay = await ingestSuppressionEvent(store, event);
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
  }
  assert.equal(store.suppressions.size, 3);
});

test("suppression and attempt limits cover all global reasons", () => {
  for (const reason of ["opt_out", "complaint", "invalid", "bounce", "dispute", "duplicate", "active_deal", "recent_contact"]) assert.equal(suppressionDecision({ attempts: 0 }, [{ reason }], []).allowed, false);
  assert.equal(suppressionDecision({ attempts: 3 }, [], []).reason, "attempt_limit");
  assert.equal(suppressionDecision({ attempts: 0 }, [], [{ at: new Date().toISOString() }]).reason, "contact_frequency");
});
