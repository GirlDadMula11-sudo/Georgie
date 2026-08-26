import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

const request = [
  "Prepare only one immutable approval plan for the governed SEO Phase 2 primary-mac snapshot reconciliation.",
  "Bind execution to developer.snapshot_reconcile_restart_from_main.",
  "mac-agent/agent.js: df95551694842535d7713016ac30770744d9721e",
  "src/governed-connector.js: f6feeb873421ac5b5aaddd1279cc56a0e4a9d777",
  "src/tools.js: 779defe2adb68f00d630d4f3c07924e942328028"
].join(" ");

test("snapshot activation prepare-only request registers an immutable approval plan instead of executing", () => {
  const actions = deterministicToolPlan(request);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, "approvals.prepare_plan");
  assert.equal(actions[0].args.execution.tool, "developer.snapshot_reconcile_restart_from_main");
  assert.equal(actions[0].args.execution.args.repo, "/Users/mac/Georgie");
  assert.deepEqual(actions[0].args.execution.args.preservePaths, [
    "mac-agent/agent.js",
    "src/governed-connector.js",
    "src/tools.js"
  ]);
  assert.deepEqual(actions[0].args.execution.args.expectedBlobs, {
    "mac-agent/agent.js": "df95551694842535d7713016ac30770744d9721e",
    "src/governed-connector.js": "f6feeb873421ac5b5aaddd1279cc56a0e4a9d777",
    "src/tools.js": "779defe2adb68f00d630d4f3c07924e942328028"
  });
});

test("snapshot approval plan fails closed when a required blob hash is missing", () => {
  const actions = deterministicToolPlan(request.replace(/src\/tools\.js:\s*[0-9a-f]{40}/, "src/tools.js: missing"));
  assert.deepEqual(actions, []);
});
