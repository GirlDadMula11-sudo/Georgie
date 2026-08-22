import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { sierraWorkflowDirectResponse } from "../src/sierra-workflow-summary.js";

test("the exact broad alignment language routes without model planning", () => {
  const plan = deterministicToolPlan("Evaluate the lack of alignment in our entire Sierra system, its speed and quality, the smooth transition, and several disconnects and gaps. Give an actual permanent solution.");
  assert.equal(plan.length, 5);
  assert.equal(plan[0].tool, "sierra.health");
});

test("deep-system Control Brief routes to current Sierra evidence, not developer search",()=>{
  const plan=deterministicToolPlan("Sierra Deep-System Integrity Program — Control Brief");
  assert.deepEqual(plan.map(item=>item.tool),["sierra.health","sierra.infrastructure","sierra.apply_inventory","sierra.reconciliation_invariant","sierra.portfolio","system.maintenance_check"]);
  assert.equal(plan.some(item=>item.tool==="developer.search"),false);
});

test("fresh integrity evidence outranks an incomplete developer search",()=>{
  const response=sierraWorkflowDirectResponse("Sierra Deep-System Integrity Program — Control Brief",[
    {ok:false,tool:"developer.search",error:"foreground deadline",durable:true,recoveryId:"old-job"},
    {ok:true,tool:"sierra.health",result:{health_status:"healthy",active_deals:27,failed_pipeline_stages:0}},
    {ok:true,tool:"sierra.infrastructure",result:{ok:true,sierra_core:{ok:true,stale_automation:0,failed_pipeline_stage:false,human_attention_pending:11},capitalapply:{issue_count:0}}},
    {ok:true,tool:"sierra.apply_inventory",result:{submissions:[]}},
    {ok:true,tool:"sierra.reconciliation_invariant",result:{exceptions:0,completeness_proven:true,sierra_observed_pass:true,authoritative_capitalapply_pass:true}},
    {ok:true,tool:"sierra.portfolio",result:{deals:Array.from({length:27})}},
    {ok:true,tool:"system.maintenance_check",result:{status:"healthy",repairs:[]}}
  ]);
  assert.equal(response.completed,true);
  assert.equal(response.terminalState,"verified");
  assert.match(response.text,/CURRENT CONTROL BRIEF/);
  assert.match(response.text,/27/);
  assert.match(response.text,/Reconciliation: VERIFIED/);
  assert.match(response.text,/Automatic maintenance: a fresh bounded observation cycle ran/);
  assert.match(response.text,/isolated engineering-evidence gap/);
  assert.match(response.text,/Fresh authoritative results.*outrank/i);
  assert.doesNotMatch(response.text,/program established; initial inspection is queued/i);
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
  assert.match(response.text, /required machine-readable business checks passed/);
  assert.match(response.text, /Standing operating loop/);
  assert.match(response.text, /No verified system defect/);
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

test("continued investigation translates raw extraction paths into a business report",()=>{
  const response=sierraWorkflowDirectResponse("continue",[{ok:true,tool:"sierra.continue_diagnostic_investigation",result:{requestId:"request-2",reference:"SCA-100",target:"Mr Muffins",status:"blocked_incomplete_evidence",steps:[{tool:"sierra.document_intelligence",status:"completed"}],synthesis:{unresolved:[{tool:"sierra.document_intelligence",paths:["result.jurisdiction.source: unknown"]}],businessGaps:[{missing:"Page-cited business jurisdiction",why:"Sierra cannot apply the correct statement rule.",source:"Signed application",nextAction:"Extract and persist the cited state."}]},repairPlan:{execution:{tool:"sierra.reprocess_documents"},scope:["existing documents only"],excluded:["lender submission"],verification:[{tool:"sierra.document_certification"},{tool:"sierra.deal_workspace"}]}}}]);
  assert.match(response.text,/Missing: Page-cited business jurisdiction/);
  assert.match(response.text,/Authoritative source: Signed application/);
  assert.match(response.text,/BOUNDED REPAIR PLAN — APPROVAL NEEDED/);
  assert.match(response.text,/deal remains blocked/i);
  assert.doesNotMatch(response.text,/result\.jurisdiction/);
});
