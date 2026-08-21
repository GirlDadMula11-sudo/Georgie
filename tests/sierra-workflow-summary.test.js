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

test("workflow response exposes the durable exact-scope approval plan",()=>{
  const response=sierraWorkflowDirectResponse("repair Sierra",[
    {ok:true,tool:"sierra.health",result:{health_status:"healthy"}},
    {ok:true,tool:"sierra.infrastructure",result:{status:"healthy"}},
    {ok:true,tool:"sierra.apply_inventory",result:{submissions:[]}},
    {ok:true,tool:"sierra.reconciliation_invariant",result:{violation_count:0}},
    {ok:true,tool:"sierra.portfolio",result:{deals:[]}},
    {ok:true,tool:"approvals.prepare_plan",result:{plan:{version:1,execution:{tool:"system.reconciliation_check"}},approval:{id:"approval-123"}}}
  ]);
  assert.match(response.text,/Approval ID: approval-123/);
  assert.match(response.text,/Exact execution: system\.reconciliation_check/);
});

test("continued investigation fails closed and returns every required outcome section",()=>{
  const response=sierraWorkflowDirectResponse("continue",[{ok:true,tool:"sierra.continue_diagnostic_investigation",result:{requestId:"request-1",reference:"Mr Muffins",continuationOf:null,status:"blocked_incomplete_evidence",steps:[{tool:"sierra.deal",status:"completed"},{tool:"sierra.reconciliation_invariant",status:"completed"}],skippedFreshTools:[],synthesis:{unresolved:[{tool:"sierra.reconciliation_invariant",reason:"required evidence contains an explicit unknown or not-returned value"}]}}}]);
  assert.equal(response.completed,false);
  assert.equal(response.terminalState,"blocked");
  for(const heading of ["What I checked","What I found","What changed","What I verified","What remains"])assert.match(response.text,new RegExp(heading));
  assert.match(response.text,/No repair plan was created/);
});