import test from "node:test";
import assert from "node:assert/strict";
import { isTransientReplyCloserInfraError, nextReplyCloserSchedule, replyCloserBackpressureContract } from "../src/smartlead-reply-backpressure.js";

test("classifies Supabase and provider transport failures as transient infrastructure pressure", () => {
  for (const message of ["The operation was aborted due to timeout", "connection reset by peer", "HTTP 503", "too many connections", "fetch failed"]) assert.equal(isTransientReplyCloserInfraError(message), true, message);
  assert.equal(isTransientReplyCloserInfraError("PROVIDER_STATS_ID_MISMATCH"), false);
});

test("transient failures back off exponentially and remain bounded", () => {
  const first = nextReplyCloserSchedule({ error: new Error("connection timeout"), failures: 0, activeMs: 30_000, idleMs: 60_000, maxBackoffMs: 180_000 });
  assert.deepEqual(first, { delayMs: 120_000, failures: 1, mode: "infra_backoff" });
  const second = nextReplyCloserSchedule({ error: new Error("connection timeout"), failures: first.failures, activeMs: 30_000, idleMs: 60_000, maxBackoffMs: 180_000 });
  assert.deepEqual(second, { delayMs: 180_000, failures: 2, mode: "infra_backoff" });
  const eighth = nextReplyCloserSchedule({ error: new Error("connection timeout"), failures: 7, activeMs: 30_000, idleMs: 60_000, maxBackoffMs: 180_000 });
  assert.deepEqual(eighth, { delayMs: 180_000, failures: 8, mode: "infra_backoff" });
});

test("idle cycles relax pressure while active jobs and provider receipts retain fast cadence", () => {
  assert.deepEqual(nextReplyCloserSchedule({ result: { ok: true, jobs: [], receipts: [] }, activeMs: 30_000, idleMs: 60_000 }), { delayMs: 60_000, failures: 0, mode: "idle" });
  assert.deepEqual(nextReplyCloserSchedule({ result: { ok: true, jobs: [{ obligationId: "x" }], receipts: [] }, failures: 3, activeMs: 30_000, idleMs: 60_000 }), { delayMs: 30_000, failures: 0, mode: "active" });
  assert.deepEqual(nextReplyCloserSchedule({ result: { ok: true, jobs: [], receipts: [{ id: "x", status: "waiting_receipt" }] }, activeMs: 30_000, idleMs: 60_000 }), { delayMs: 30_000, failures: 0, mode: "active" });
});

test("transient reconciliation errors trigger backpressure without treating them as business failures", () => {
  const next = nextReplyCloserSchedule({ result: { ok: true, jobs: [], receipts: [{ status: "reconcile_batch_error", error: "The operation was aborted due to timeout" }] }, failures: 0, activeMs: 30_000, idleMs: 60_000, maxBackoffMs: 180_000 });
  assert.deepEqual(next, { delayMs: 120_000, failures: 1, mode: "infra_backoff" });
});

test("backpressure contract preserves active conversion cadence and removes fixed interval polling", () => {
  assert.equal(replyCloserBackpressureContract.adaptiveSelfScheduling, true);
  assert.equal(replyCloserBackpressureContract.fixedIntervalPolling, false);
  assert.equal(replyCloserBackpressureContract.receiptReconcileStaysActive, true);
});
