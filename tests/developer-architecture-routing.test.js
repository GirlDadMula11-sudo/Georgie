import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("explicit read-only architecture analysis uses bounded source search", () => {
  const plan = deterministicToolPlan(
    "Analyze the Georgie codebase architecture for reliability weaknesses, silent turns, lost continuity, and false completion claims. Do not modify anything."
  );
  assert.equal(plan.length, 1);
  assert.equal(plan[0].tool, "developer.search");
});

test("broad Georgie improvement requests still reach the normal planner", () => {
  const plan = deterministicToolPlan(
    "Strengthen Georgie and repair every reliability weakness across the platform."
  );
  assert.deepEqual(plan, []);
});
