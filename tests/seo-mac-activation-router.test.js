import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("routes the governed primary-mac snapshot activation directly with exact hashes", () => {
  const plan = deterministicToolPlan(
    "Execute developer.snapshot_reconcile_restart_from_main on primary-mac for /Users/mac/Georgie " +
    "with mac-agent/agent.js:df95551694842535d7713016ac30770744d9721e, " +
    "src/governed-connector.js=f6feeb873421ac5b5aaddd1279cc56a0e4a9d777, " +
    "src/tools.js:779defe2adb68f00d630d4f3c07924e942328028."
  );
  assert.deepEqual(plan, [{
    tool: "developer.snapshot_reconcile_restart_from_main",
    args: {
      repo: "/Users/mac/Georgie",
      preservePaths: ["mac-agent/agent.js", "src/governed-connector.js", "src/tools.js"],
      expectedBlobs: {
        "mac-agent/agent.js": "df95551694842535d7713016ac30770744d9721e",
        "src/governed-connector.js": "f6feeb873421ac5b5aaddd1279cc56a0e4a9d777",
        "src/tools.js": "779defe2adb68f00d630d4f3c07924e942328028"
      }
    }
  }]);
});

test("routes missing snapshot hashes fail-closed to the governed tool", () => {
  const [action] = deterministicToolPlan("Execute developer.snapshot_reconcile_restart_from_main on primary-mac.");
  assert.equal(action.tool, "developer.snapshot_reconcile_restart_from_main");
  assert.equal(action.args.expectedBlobs["mac-agent/agent.js"], "");
});
