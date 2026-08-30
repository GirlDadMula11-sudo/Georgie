import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("exact approval plan ledger requests bypass approval receipt routing", () => {
  assert.deepEqual(
    deterministicToolPlan("Run approvals.plans limit=100."),
    [{tool:"approvals.plans",args:{limit:100}}]
  );
});

test("approval plan ledger limits remain bounded", () => {
  assert.deepEqual(
    deterministicToolPlan("Run approvals.plans limit=999."),
    [{tool:"approvals.plans",args:{limit:100}}]
  );
});
