import test from "node:test";
import assert from "node:assert/strict";
import { macQueueCloudRefreshPolicy } from "../src/mac/queue.js";

test("Mac queue claims reconcile durable state across Render instances", () => {
  const policy = macQueueCloudRefreshPolicy();
  assert.equal(policy.mode, "durable_claim_reconciliation");
  assert.equal(policy.foregroundPollReadsCloud, true);
  assert.equal(policy.mutationsMirrorCloud, "asynchronous_coalesced_with_synchronous_claim_completion");
  assert.equal(policy.refreshCoalesced, true);
  assert.equal(policy.unchangedPollWrites, false);
  assert.ok(policy.intervalMs >= 10_000);
});
