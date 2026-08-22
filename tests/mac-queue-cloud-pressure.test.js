import test from "node:test";
import assert from "node:assert/strict";
import { macQueueCloudRefreshPolicy } from "../src/mac/queue.js";

test("Mac queue polling is local-first and cannot issue one cloud RPC per poll", () => {
  const policy = macQueueCloudRefreshPolicy();
  assert.equal(policy.mode, "local_hot_path_cloud_reconciliation");
  assert.equal(policy.foregroundPollReadsCloud, false);
  assert.equal(policy.mutationsMirrorCloud, true);
  assert.equal(policy.refreshCoalesced, true);
  assert.ok(policy.intervalMs >= 10_000);
});
