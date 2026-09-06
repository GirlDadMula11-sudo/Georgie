import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { createFinancingRecoveryRouter } from "../src/financing-recovery-router.js";

const migration = fs.readFileSync(new URL("../supabase/migrations/202609052030_rehash_revenue_funnel_v1.sql", import.meta.url), "utf8");

test("rehash funnel migration is private, token-scoped, and exposes aggregate report only to service role", () => {
  assert.match(migration, /georgie_recovery_funnel_events/);
  assert.match(migration, /georgie_record_recovery_funnel_event_v1/);
  assert.match(migration, /georgie_rehash_funnel_v1/);
  assert.match(migration, /where token_hash=p_token_hash/i);
  assert.match(migration, /event_key text not null unique/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.georgie_recovery_funnel_events from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.georgie_rehash_funnel_v1\(\) to service_role/i);
  assert.doesNotMatch(migration, /bank account|transaction data|filename/i);
});

test("opening a valid secure recovery session records a nonfatal funnel event", async () => {
  const token = "abcdefghijklmnopqrstuvwxyz1234567890";
  const events = [];
  const store = {
    getUploadSession: async () => ({ status: "active", complete: false, slots: [] }),
    recordFunnelEvent: async event => { events.push(event); return { ok: true }; }
  };
  const app = express().use(express.json()).use("/recovery", createFinancingRecoveryRouter({ store }));
  const server = app.listen(0);
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/recovery/upload-session`, { headers: { "x-recovery-upload-token": token } });
    assert.equal(response.status, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "secure_link_opened");
    assert.match(events[0].tokenHash, /^[a-f0-9]{64}$/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("funnel tracking failure never blocks the secure session", async () => {
  const token = "abcdefghijklmnopqrstuvwxyz1234567890";
  const store = {
    getUploadSession: async () => ({ status: "active", complete: false, slots: [] }),
    recordFunnelEvent: async () => { throw new Error("telemetry unavailable"); }
  };
  const app = express().use(express.json()).use("/recovery", createFinancingRecoveryRouter({ store }));
  const server = app.listen(0);
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/recovery/upload-session`, { headers: { "x-recovery-upload-token": token } });
    assert.equal(response.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
