import test from "node:test";
import assert from "node:assert/strict";
import { interpretOperatingObjective, runtimeToolReadiness } from "../src/unified-operating-runtime.js";

test("interprets ordinary continuation, approval, engineering, and Sierra intent", () => {
  const objective = interpretOperatingObjective("Continue fixing the Sierra repository and deploy it—you have my approval.");
  assert.equal(objective.continuation, true);
  assert.equal(objective.approval, true);
  assert.equal(objective.execution, true);
  assert.equal(objective.kind, "engineering");
  assert.equal(objective.domain, "sierra");
  assert.equal(objective.requiresTools, true);
});

test("tool readiness distinguishes attached tools from configured execution", () => {
  const readiness = runtimeToolReadiness({ mode: "persistent_governed_registry", attachedToEveryTurn: true, tools: [
    { name: "system.status", attached: true, configured: true },
    { name: "sierra.deal", attached: true, configured: false, precondition: "secure_sierra_workforce_configuration" },
  ] });
  assert.equal(readiness.attachedToEveryTurn, true);
  assert.equal(readiness.registered, 2);
  assert.equal(readiness.attached, 2);
  assert.equal(readiness.configured, 1);
  assert.deepEqual(readiness.blocked, [{ tool: "sierra.deal", precondition: "secure_sierra_workforce_configuration" }]);
});

test("high-consequence actions are recognized for governed approval", () => {
  const objective = interpretOperatingObjective("Submit this deal to the lender and send the email.");
  assert.equal(objective.execution, true);
  assert.equal(objective.consequencePossible, true);
  assert.equal(objective.domain, "sierra");
});


test("explicitly non-mutating inspection is not elevated by prohibited production or lender language", () => {
  const objective = interpretOperatingObjective("Inspect the connector in read-only mode. Do not change production. Do not submit anything to lenders.");
  assert.equal(objective.inspection, true);
  assert.equal(objective.consequencePossible, false);
});

test("affirmative consequential actions still require consequence handling", () => {
  assert.equal(interpretOperatingObjective("Deploy the repair to production.").consequencePossible, true);
  assert.equal(interpretOperatingObjective("Submit this deal to the lender.").consequencePossible, true);
});
