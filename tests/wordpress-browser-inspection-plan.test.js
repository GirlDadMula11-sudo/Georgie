import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("WordPress browser inspection request produces a complete immutable approval plan", () => {
  const actions = deterministicToolPlan(
    "Prepare one immutable bounded approval plan for mac.browser_inspect on sierramarketinginc.com to verify the WordPress admin session."
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, "approvals.prepare_plan");
  const plan = actions[0].args;
  assert.equal(plan.execution.tool, "mac.browser_inspect");
  assert.deepEqual(plan.execution.args.domains, ["sierramarketinginc.com"]);
  assert.equal(plan.execution.args.deviceId, "primary-mac");
  assert.equal(plan.execution.args.includeContent, false);
  assert.ok(plan.steps.length >= 3);
  assert.match(plan.verificationMethod, /authentication state/i);
  assert.match(plan.rollbackPlan, /read-only/i);
});


test("WordPress browser inspection can explicitly include visible content under approval", () => {
  const actions = deterministicToolPlan(
    "Prepare one immutable bounded approval plan for mac.browser_inspect on sierramarketinginc.com to verify the WordPress admin session with includeContent true."
  );
  assert.equal(actions.length, 1);
  assert.equal(actions[0].args.execution.args.includeContent, true);
});
