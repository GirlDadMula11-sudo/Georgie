import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("exact developer check marker creates a versioned execution plan", () => {
  const actions = deterministicToolPlan("DEVELOPER_RUN_CHECKS_JSON:" + JSON.stringify({repo:"/Users/mac/Georgie",script:"check"}));
  assert.equal(actions[0].tool, "approvals.prepare_plan");
  assert.equal(actions[0].args.execution.tool, "developer.run_checks");
  assert.deepEqual(actions[0].args.execution.args, {repo:"/Users/mac/Georgie",script:"check",deviceId:"primary-mac"});
});

test("developer check marker rejects arbitrary scripts", () => {
  assert.deepEqual(deterministicToolPlan("DEVELOPER_RUN_CHECKS_JSON:" + JSON.stringify({repo:"/Users/mac/Georgie",script:"install"})), []);
});
