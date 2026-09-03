import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrismPrecontactPacket, EVIDENCE_CONNECTOR_CONTRACT, evidenceProcessingKey, ingestBulkEvidence
} from "../src/financing-recovery-evidence.js";
import {
  completeStatementUpload, coordinateChannelStep, createUploadTokenRequest, GEORGIE_CLOSER_AUTHORITY,
  processSmsWebhook, recoveryEconomics, recoveryTemplates, uploadProgressAction, SMS_ADAPTER_CONTRACT, validateSmsAdapter
} from "../src/financing-recovery-engagement.js";
import { ingestRecoveryCandidate, prioritizeHistoricalRehashes, processRecoveryIntent, requiredStatementMonths } from "../src/financing-recovery.js";
import { financingRecoveryReadiness } from "../src/financing-recovery-readiness.js";

const pdf = Buffer.from("%PDF- synthetic safe fixture");
const historical = overrides => ({ lane: "historical", sourceApplicationId: "old-1", email: "owner@example.com", canonicalDealVerified: true, canonicalDealEvidenceId: "crm-1", consentBasis: { verified: true, evidenceId: "consent-1" }, evidenceIds: ["application-1"], documents: [], ...overrides });

test("every identity-and-consent-valid rehash remains included while expected return only orders contact", async () => {
  const values = [{ id: "low", expectedReturn: -10, confidence: 1 }, { id: "high", expectedReturn: 100, confidence: 0.8 }, { id: "unknown" }];
  assert.deepEqual(prioritizeHistoricalRehashes(values).map(value => value.id), ["high", "unknown", "low"]);
  const calls = [];
  await ingestRecoveryCandidate({ transactIntake: async (candidate, intent) => calls.push({ candidate, intent }) }, historical());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].intent.kind, "prism_precontact");
});

test("historical requires exactly two recent missing months while new uses authoritative product months", () => {
  assert.deepEqual(requiredStatementMonths({ lane: "historical", asOf: new Date("2026-09-03"), jurisdiction: "NY" }), ["2026-08", "2026-07"]);
  assert.deepEqual(requiredStatementMonths({ lane: "historical", asOf: new Date("2026-09-03"), documents: [{ statementMonth: "2026-08", verified: true }] }), ["2026-07", "2026-06"]);
  assert.deepEqual(requiredStatementMonths({ lane: "new", authoritativeMissingMonths: ["2026-08"] }), ["2026-08"]);
  assert.throws(() => requiredStatementMonths({ lane: "new" }), /AUTHORITATIVE_PRODUCT/);
});

test("Prism precontact packet limits fields and low confidence falls back to generic facts", () => {
  const packet = buildPrismPrecontactPacket({ applicantId: "a", dealId: "d", evidenceVersion: "v", confidence: 0.4, evidenceIds: ["e1"], firstName: "Ava", businessIdentity: "Bakery", missingMonths: ["2026-08", "2026-07"], cashFlowSummary: { averageRevenue: 50000 }, rawTransactions: ["secret"] });
  assert.equal(packet.personalizationMode, "generic_factual");
  assert.equal(packet.facts.businessIdentity, null);
  assert.equal(packet.facts.cashFlowSummary, null);
  assert.equal("rawTransactions" in packet.facts, false);
  assert.deepEqual(packet.facts.missingRecentMonths, ["2026-08", "2026-07"]);
});

test("unchanged evidence creates one Prism precontact intent and queues outreach only after packet persistence", async () => {
  const intents = new Set();
  const store = { transactIntake: async (_candidate, intent) => { const created = !intents.has(intent.key); intents.add(intent.key); return { created, intent }; } };
  await Promise.all([ingestRecoveryCandidate(store, historical()), ingestRecoveryCandidate(store, historical())]);
  assert.equal(intents.size, 1);
  const previous = process.env.GEORGIE_RECOVERY_UPLOAD_ORIGIN;
  process.env.GEORGIE_RECOVERY_UPLOAD_ORIGIN = "https://upload.example";
  let issued = 0, persisted = 0;
  try {
    await processRecoveryIntent({ issueUploadToken: async request => { issued += 1; assert.equal(request.requestedMonths.length, 2); }, recordPrismPrecontact: async (_intent, packet, link) => { persisted += 1; assert.equal(packet.facts.missingRecentMonths.length, 2); assert.match(link, /^https:\/\/upload\.example/); } }, { kind: "prism_precontact", applicantId: "a", dealId: "d", missingMonths: ["2026-08", "2026-07"], evidenceIds: ["e"], evidenceVersion: "v", confidence: 0.3 });
  } finally { if (previous === undefined) delete process.env.GEORGIE_RECOVERY_UPLOAD_ORIGIN; else process.env.GEORGIE_RECOVERY_UPLOAD_ORIGIN = previous; }
  assert.equal(issued, 1); assert.equal(persisted, 1);
});

test("provider-neutral bulk evidence hashes, deduplicates and quarantines ambiguous matches", async () => {
  const records = new Map(), quarantines = [];
  const store = { persistEvidence: async evidence => { const created = !records.has(evidence.contentHash); records.set(evidence.contentHash, evidence); return { created }; }, quarantineEvidence: async (evidence, reason) => { quarantines.push({ evidence, reason }); return { quarantined: true }; } };
  const descriptors = [{ id: "one" }, { id: "duplicate" }, { id: "ambiguous" }];
  const connector = { contract: EVIDENCE_CONNECTOR_CONTRACT, list: async () => descriptors, read: async descriptor => ({ buffer: pdf, name: `${descriptor.id}.pdf`, mimeType: "application/pdf" }), extract: async ({ descriptor }) => ({ type: "bank_statement", statementMonth: "2026-08", bank: "Bank", accountEnding: "1234", businessIdentity: "Bakery", evidenceIds: [`extract-${descriptor.id}`], confidence: 0.95 }), match: async ({ extracted }) => extracted.evidenceIds[0].includes("ambiguous") ? { ambiguous: true } : { canonical: true, applicantId: "a" } };
  await ingestBulkEvidence(connector, store, { sourceId: "authorized-export-1", authorized: true });
  assert.equal(records.size, 1);
  assert.equal(quarantines.length, 1);
  assert.match(evidenceProcessingKey([...records.keys()][0]), /^document-process:/);
});

test("opaque upload tokens are scoped to two slots and duplicate uploads cannot duplicate completion", async () => {
  const request = createUploadTokenRequest({ applicantId: "a", episodeId: "ep", requestedMonths: ["2026-08", "2026-07"], expiresAt: new Date(Date.now() + 86400000) });
  assert.equal(request.tokenHash.length, 64); assert.notEqual(request.token, request.tokenHash); assert.equal(request.slots.length, 2);
  const uploads = new Set(); let crmEvents = 0;
  const store = { resolveUploadToken: async tokenHash => tokenHash === request.tokenHash ? request : null, transactUploadCompletion: async upload => { const created = !uploads.has(upload.idempotencyKey); uploads.add(upload.idempotencyKey); if (uploads.size === 2 && created) crmEvents += 1; return { created, complete: uploads.size === 2 }; } };
  const options = month => ({ token: request.token, file: { buffer: Buffer.concat([pdf, Buffer.from(month)]), name: `${month}.pdf`, mimeType: "application/pdf" }, scan: async () => ({ clean: true, receiptId: "scan-1" }), validateDocument: async () => ({ verified: true, statementMonth: month, businessMatch: true, evidenceIds: [`doc-${month}`] }) });
  await Promise.all([completeStatementUpload(store, options("2026-08")), completeStatementUpload(store, options("2026-08"))]);
  assert.equal(uploads.size, 1); assert.equal(crmEvents, 0);
  await Promise.all([completeStatementUpload(store, options("2026-07")), completeStatementUpload(store, options("2026-07"))]);
  assert.equal(uploads.size, 2); assert.equal(crmEvents, 1);
  assert.match(uploadProgressAction({ requestedMonths: request.requestedMonths, verifiedMonths: ["2026-08"] }).copy, /no new application is needed/i);
  assert.deepEqual(uploadProgressAction({ requestedMonths: request.requestedMonths, verifiedMonths: ["2026-08"] }).missingMonths, ["2026-07"]);
});

test("email and SMS templates are concise, safe, and explicitly require no new application", () => {
  const args = { firstName: "Ava", businessIdentity: "A Bakery", missingMonths: ["2026-08", "2026-07"], secureLink: "https://upload.example/opaque", prismPacket: { personalizationMode: "verified" } };
  const email = recoveryTemplates({ channel: "email", ...args }), sms = recoveryTemplates({ channel: "sms", ...args });
  assert.equal(email.subject, "Two updated bank statements needed");
  assert.match(email.body, /already has your application information/); assert.match(email.body, /no new application is needed/);
  assert.match(sms.body, /Reply STOP to opt out or HELP for help/); assert.ok(sms.body.length < 320);
  for (const text of [email.body, sms.body]) assert.doesNotMatch(text, /approved|guaranteed|interest rate|offer amount/i);
});

test("omnichannel state prevents redundant same-step messages", () => {
  const first = coordinateChannelStep({ conversationId: "c", events: [] }, { channel: "email", step: "initial", idempotencyKey: "e1" });
  assert.equal(first.allowed, true);
  const second = coordinateChannelStep({ conversationId: "c", events: [first.event] }, { channel: "sms", step: "initial", idempotencyKey: "s1" });
  assert.deepEqual(second, { allowed: false, reason: "same_step_already_active", existingChannel: "email" });
});

test("SMS requires a configured registered adapter and signed replay-safe STOP/HELP events", async () => {
  const events = new Set();
  const replayStore = { transactSmsEvent: async event => { const created = !events.has(event.idempotencyKey); events.add(event.idempotencyKey); return { created, command: event.command }; } };
  const adapter = { contract: SMS_ADAPTER_CONTRACT, configured: true, number: "+15555550123", registrationVerified: true, webhookVerificationConfigured: true, send() {}, verifyWebhook: event => event.signature === "valid" };
  assert.equal(validateSmsAdapter(adapter), true);
  const event = { eventId: "evt-1", body: "STOP", signature: "valid" };
  assert.equal((await processSmsWebhook(adapter, event, replayStore)).command, "STOP");
  assert.equal((await processSmsWebhook(adapter, event, replayStore)).created, false);
  assert.throws(() => processSmsWebhook(adapter, { ...event, signature: "bad" }, replayStore), /SIGNED_SMS/);
});

test("closer authority is Georgie-first, economics are outcome-oriented, and readiness stays red without integrations", () => {
  assert.equal(GEORGIE_CLOSER_AUTHORITY.owner, "georgie"); assert.equal(GEORGIE_CLOSER_AUTHORITY.humanEscalationOnly.length, 4);
  assert.deepEqual(recoveryEconomics([{ type: "email", cost: 0.01 }, { type: "sms", cost: 0.02 }, { type: "document_processing", cost: 0.2 }, { type: "package_recovered" }, { type: "funded", amount: 50000 }, { type: "revenue", amount: 5000 }]), { contract: "georgie.recovery-economics.v1", emailCost: 0.01, smsCost: 0.02, modelCost: 0, documentProcessingCost: 0.2, recoveredPackages: 1, fundedDeals: 1, fundedDollars: 50000, revenue: 5000 });
  const readiness = financingRecoveryReadiness({ env: {} });
  assert.equal(readiness.ready, false); assert.equal(readiness.checks.evidenceVaultConnector, false); assert.equal(readiness.checks.smsProviderNumberRegistration, false); assert.equal(readiness.checks.outreachHeld, true);
});
