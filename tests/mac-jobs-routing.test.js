import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("recent primary-mac job receipt reads bypass the model router", () => {
  const actions = deterministicToolPlan(
    "List the 20 most recent primary-mac jobs and return action, status, error, and result fields."
  );
  assert.deepEqual(actions, [{ tool: "mac.jobs", args: { limit: 20 } }]);
});
