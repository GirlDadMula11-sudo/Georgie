import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { createFinancingRecoveryRouter } from "../src/financing-recovery-router.js";

const migration = fs.readFileSync(new URL("../supabase/migrations/202609030001_financing_recovery.sql", import.meta.url), "utf8");

test("database contract atomically deduplicates intake, replies, suppressions, and leased claims", () => {
  assert.match(migration, /georgie_recovery_ingest_candidate_v2/);
  assert.match(migration, /georgie_recovery_ingest_reply_v2/);
  assert.match(migration, /on conflict\(event_key\) do nothing/i);
  assert.match(migration, /on conflict\(idempotency_key\) do nothing/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /lease_token=p_lease and status='processing'/i);
  assert.match(migration, /COMPLETE_PROVIDER_AND_SIERRA_RECEIPT_REQUIRED/);
  assert.match(migration, /DOWNSTREAM_RECEIPT_READBACK_REQUIRED/);
});

test("versioned intake endpoint authenticates and dispatches only validated canonical data", async () => {
  const prior = process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN;
  process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN = "12345678901234567890123456789012";
  let calls = 0;
  const store = { transactIntake: async () => { calls += 1; return { intentCreated: true }; } };
  const app = express().use(express.json()).use("/recovery", createFinancingRecoveryRouter({ store }));
  const server = app.listen(0);
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const unauthorized = await fetch(`${origin}/recovery/intake`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    const rejected = await fetch(`${origin}/recovery/intake`, { method: "POST", headers: { "content-type": "application/json", "x-georgie-recovery-token": process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN }, body: JSON.stringify({ rawApplication: true, lane: "new" }) });
    assert.equal(rejected.status, 400);
    assert.equal(calls, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (prior === undefined) delete process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN; else process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN = prior;
  }
});

test("rehash schema deduplicates evidence, upload slots, channel steps, CRM and Prism work", () => {
  const extension = fs.readFileSync(new URL("../supabase/migrations/202609030002_rehash_evidence_upload.sql", import.meta.url), "utf8");
  assert.match(extension, /content_hash text not null unique/i);
  assert.match(extension, /unique\(episode_id,statement_month\)/i);
  assert.match(extension, /unique\(episode_id,step\)/i);
  assert.match(extension, /'crm-intake:'\|\|token\.episode_id/i);
  assert.match(extension, /on conflict\(event_key\) do nothing/i);
  assert.match(extension, /'prism-precontact:'\|\|\(p_packet->>'evidenceVersion'\)/i);
  assert.match(extension, /georgie_revoke_recovery_upload_token_v1/);
  assert.match(extension, /p_event->>'command'='STOP'/);
});
