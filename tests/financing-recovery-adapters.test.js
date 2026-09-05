import test from "node:test";
import assert from "node:assert/strict";
import {
  CRM_CONTRACT, MALWARE_CONTRACT, PRISM_REVIEW_CONTRACT, STATEMENT_BUCKET, STORAGE_CONTRACT,
  adapterInventory, createPrismReviewAdapter, createSierraCrmAdapter, createStatementValidator,
  createSupabaseStatementStorage, createUnconfiguredSmsAdapter, normalizeChannelWebhook
} from "../src/integrations/financing-recovery-adapters.js";
import { canaryGate, runSyntheticRehashCanary } from "../src/financing-recovery-canary.js";
import { recoveryOperationalReport } from "../src/financing-recovery-observability.js";
import { communicationGate } from "../src/financing-recovery-engagement.js";

const env = { GEORGIE_SUPABASE_URL: "https://project.supabase.co", GEORGIE_SUPABASE_SERVICE_ROLE_KEY: "secret-test-value" };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const recoveryBucket = { public: false, file_size_limit: 50 * 1024 * 1024 };

test("Supabase adapter enforces a private 50 MB bucket and immutable content-addressed receipts", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => { calls.push({ url, options }); if (url.endsWith(`/bucket/${STATEMENT_BUCKET}`)) return response(200, recoveryBucket); return response(200, { Key: "provider-object" }); };
  const storage = createSupabaseStatementStorage({ env, fetchImpl });
  const hash = "a".repeat(64), receipt = await storage.putImmutable({ applicantId: "app", episodeId: "deal", contentHash: hash, buffer: Buffer.from("file"), mimeType: "application/pdf", retentionUntil: "2033-09-03T00:00:00Z" });
  assert.equal(storage.contract, STORAGE_CONTRACT); assert.equal(receipt.immutable, true); assert.equal(receipt.contentHash, hash); assert.equal(receipt.bucket, STATEMENT_BUCKET);
  assert.ok(calls.some(call => call.options.headers?.["x-upsert"] === "false"));
  assert.equal(calls.some(call => JSON.stringify(call).includes("secret-test-value")), true);
  assert.equal(JSON.stringify(receipt).includes("secret-test-value"), false);
});

test("storage deduplicates only after authoritative object read-back", async () => {
  let upload = 0, info = 0;
  const storage = createSupabaseStatementStorage({ env, fetchImpl: async (url, options = {}) => { if (url.includes("/bucket/")) return response(200, recoveryBucket); if (url.includes("/object/info/")) { info += 1; return response(200, {}); } if (options.method === "POST") { upload += 1; return response(409, {}); } return response(200, {}); } });
  const receipt = await storage.putImmutable({ applicantId: "a", episodeId: "d", contentHash: "b".repeat(64), buffer: Buffer.from("x"), mimeType: "application/pdf", retentionUntil: "2033-01-01" });
  assert.equal(receipt.deduplicated, true); assert.equal(upload, 1); assert.equal(info, 1);
});

test("statement validator fails closed and requires scanner receipt, identity, month and confidence", async () => {
  const input = { buffer: Buffer.from("x"), contentHash: "c".repeat(64), requestedMonths: ["2026-08", "2026-07"], applicantId: "a" };
  await assert.rejects(() => createStatementValidator({})(input), /MALWARE_SCANNER/);
  const scanner = { contract: MALWARE_CONTRACT, scan: async () => ({ clean: true, receiptId: "scan-1" }) };
  const valid = createStatementValidator({ malwareScanner: scanner, duplicateLookup: async () => ({ found: false }), extract: async () => ({ applicantId: "a", businessMatch: true, statementMonth: "2026-08", confidence: .95, evidenceIds: ["extract-1"] }) });
  assert.equal((await valid(input)).verified, true);
  const wrong = createStatementValidator({ malwareScanner: scanner, duplicateLookup: async () => ({ found: false }), extract: async () => ({ applicantId: "a", businessMatch: true, statementMonth: "2026-06", confidence: .95, evidenceIds: ["e"] }) });
  await assert.rejects(() => wrong(input), /MONTH_OR_BUSINESS/);
});

test("Prism normalizes only matching receipt-bearing assessments and is truthful when absent", async () => {
  const absent = createPrismReviewAdapter({ endpoint: "", credential: "" }); assert.equal(absent.configured, false); await assert.rejects(() => absent.review({}), /NOT_CONFIGURED/);
  const adapter = createPrismReviewAdapter({ endpoint: "https://prism.test/review", credential: "secret", fetchImpl: async () => ({ ok: true, json: async () => ({ contract: "georgie.prism-assessment.v1", receiptId: "p1", evidenceVersion: "v1", confidence: .9, evidenceIds: ["e"], safeCues: [], readBack: { verified: true } }) }) });
  const receipt = await adapter.review({ contract: PRISM_REVIEW_CONTRACT, evidenceVersion: "v1" }); assert.equal(receipt.receiptId, "p1"); assert.equal("secret" in receipt, false);
});

test("CRM adapter gates raw applications and reads back one canonical external identity", async () => {
  let writes = 0;
  const adapter = createSierraCrmAdapter({ execute: async () => { writes += 1; return { external_id: "ext-1", receipt_id: "crm-r1" }; }, readBack: async () => ({ deal_id: "ext-1" }) });
  assert.equal(adapter.contract, CRM_CONTRACT);
  await assert.rejects(() => adapter.upsertCanonical("u", { rawApplication: true }), /CANONICAL_GATE/);
  const receipt = await adapter.upsertCanonical("u", { rawApplication: false, verifiedStatementCount: 2, approvalId: "approval", idempotencyKey: "crm-key", canonicalDealId: "deal", evidenceIds: ["s1", "s2"] });
  assert.equal(receipt.externalId, "ext-1"); assert.equal(receipt.readBack.verified, true); assert.equal(writes, 1);
});

test("webhooks require signatures and normalize delivery, bounce, complaint, STOP and HELP", () => {
  for (const [channel, event, type] of [["email", { eventId: "1", type: "delivered" }, "delivered"], ["email", { eventId: "2", type: "bounce" }, "bounce"], ["email", { eventId: "3", type: "complaint" }, "complaint"], ["sms", { eventId: "4", body: "STOP" }, "opt_out"], ["sms", { eventId: "5", body: "HELP" }, "help"]]) assert.equal(normalizeChannelWebhook({ channel, event, signatureVerified: true }).type, type);
  assert.throws(() => normalizeChannelWebhook({ channel: "sms", event: { eventId: "x" }, signatureVerified: false }), /SIGNED/);
  assert.equal(createUnconfiguredSmsAdapter({}).configured, false);
});

test("synthetic canary cannot escape mode, explicit allowlists, or reserved destinations", async () => {
  const baseEnv = { CANARY_MODE: "true", CANARY_EMAIL_ALLOWLIST: "canary@example.com", CANARY_PHONE_ALLOWLIST: "+15550123" };
  assert.throws(() => canaryGate({ env: {}, email: "canary@example.com", phone: "+15550123" }), /CANARY_MODE/);
  assert.throws(() => canaryGate({ env: { ...baseEnv, CANARY_EMAIL_ALLOWLIST: "real@business.com" }, email: "real@business.com", phone: "+15550123" }), /SYNTHETIC/);
  const report = await runSyntheticRehashCanary({ env: baseEnv, email: "canary@example.com", phone: "+15550123", adapters: {} });
  assert.equal(report.internalPipelineVerified, true); assert.equal(report.livePipelineVerified, false); assert.equal(report.firstBlockedLiveBoundary, "database"); assert.equal(report.providerMessagesSent, 0); assert.equal(report.productionDataUsed, false); assert.equal(report.destinations.phoneMasked, "***0123");
});

test("observability is structured, secret-free and red at exact first missing boundaries", () => {
  const inventory = { database: true, storage: true, storagePublic: false, storageBucket: STATEMENT_BUCKET, malware: false, prism: false, crm: false, email: false, sms: false, webhooks: { email: false, sms: false } };
  const report = recoveryOperationalReport({ env: {}, inventory });
  assert.equal(report.ready, false); assert.equal(report.sendsEnabled, false); assert.equal(report.storage.public, false); assert.ok(report.blockers.includes("validators_not_verified")); assert.equal(report.secretsExposed, false);
  assert.equal(adapterInventory({ env: {} }).storagePublic, false);
});

test("suppression precedes frequency and quiet-hour gates fail closed", () => {
  assert.equal(communicationGate({ suppression: "complaint", lastContactAt: new Date().toISOString(), quietHoursUtc: "bad" }).reason, "suppressed:complaint");
  assert.equal(communicationGate({ lastContactAt: new Date().toISOString() }).reason, "frequency_limit");
  assert.equal(communicationGate({ now: new Date("2026-09-03T03:00:00Z"), quietHoursUtc: "02:00-12:00" }).reason, "quiet_hours");
  assert.equal(communicationGate({ quietHoursUtc: "bad" }).reason, "quiet_hours_configuration_invalid");
});
