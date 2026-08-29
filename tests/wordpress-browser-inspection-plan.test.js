import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("WordPress browser inspection request produces a targeted immutable approval plan", () => {
  const actions = deterministicToolPlan(
    "Prepare one immutable bounded approval plan for mac.wordpress_hostinger_inspect on sierramarketinginc.com to verify the WordPress admin session."
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, "approvals.prepare_plan");
  const plan = actions[0].args;
  assert.equal(plan.execution.tool, "mac.wordpress_hostinger_inspect");
  assert.equal(plan.execution.args.siteOrigin, "https://sierramarketinginc.com");
  assert.equal(plan.execution.args.deviceId, "primary-mac");
  assert.equal(plan.execution.args.authority, "read_only");
  assert.equal(plan.execution.args.operation, "inspect_session");
  assert.ok(plan.steps.length >= 3);
  assert.match(plan.verificationMethod, /authentication state/i);
  assert.match(plan.rollbackPlan, /read-only/i);
});

test("legacy browser inspection wording is safely upgraded to the targeted handler", () => {
  const actions = deterministicToolPlan(
    "Prepare one immutable bounded approval plan for mac.browser_inspect on sierramarketinginc.com to verify the WordPress admin session."
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].args.execution.tool, "mac.wordpress_hostinger_inspect");
});

test("Georgie update request produces a bounded update-and-restart approval plan", () => {
  const actions = deterministicToolPlan(
    "Prepare one immutable bounded approval plan for developer.update_restart_from_main at /Users/mac/Georgie."
  );
  assert.equal(actions.length, 1);
  const plan = actions[0].args;
  assert.equal(plan.execution.tool, "developer.update_restart_from_main");
  assert.deepEqual(plan.execution.args, { repo: "/Users/mac/Georgie", deviceId: "primary-mac" });
  assert.match(plan.verificationMethod, /heartbeat/i);
});
