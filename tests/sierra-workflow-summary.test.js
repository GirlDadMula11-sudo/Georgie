import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { sierraWorkflowDirectResponse } from "../src/sierra-workflow-summary.js";

test("the exact broad alignment language routes without model planning", () => {
  const plan = deterministicToolPlan("Evaluate the lack of alignment in our entire Sierra system, its speed and quality, the smooth transition, and several disconnects and gaps. Give an actual permanent solution.");
  assert.equal(plan.length, 5);
  assert.equal(plan[0].tool, "sierra.health");
});

test("workflow evidence produces a useful immediate terminal assessment", () => {
  const response = sierraWorkflowDirectResponse("evaluate Sierra alignment", [
    { ok: true, tool: "sierra.health", result: { health_status: "healthy", active_deals: 21, failed_pipeline_stages: 0 } },
    { ok: true, tool: "sierra.infrastructure", result: { status: "healthy" } },
    { ok: true, tool: "sierra.apply_inventory", result: { submissions: [{ id: 1 }, { id: 2 }] } },
    { ok: true, tool: "sierra.reconciliation_invariant", result: { violation_count: 0 } },
    { ok: true, tool: "sierra.portfolio", result: { deals: Array.from({ length: 21 }) } },
  ]);
  assert.match(response.text, /21/);
  assert.match(response.text, /All five governed read contracts returned successfully/);
  assert.match(response.text, /Permanent-solution path/);
  assert.match(response.text, /No deal.*was changed/);
});
