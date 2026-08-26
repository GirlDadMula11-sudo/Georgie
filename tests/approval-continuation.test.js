import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan, latestDeterministicApprovalPlan } from "../src/fast-intents.js";
import { isConversationalApproval, preflightExecution } from "../src/approval-continuation.js";
import { sierraWorkflowDirectResponse } from "../src/sierra-workflow-summary.js";
import { approvalDispatchPolicy, isApprovalDispatchTool } from "../src/tools.js";


test("approval recovery dispatches only Mac tools and the exact governed developer reconciliation",()=>{
  assert.equal(isApprovalDispatchTool("mac.browser_workflow"),true);
  assert.equal(isApprovalDispatchTool("developer.snapshot_reconcile_restart_from_main"),true);
  assert.equal(isApprovalDispatchTool("developer.repo_inspect"),false);
  assert.equal(isApprovalDispatchTool("system.reconciliation_execute_bounded"),false);
});

test("approved plans dispatch immediately without two-second idle cloud polling",()=>{
  const policy=approvalDispatchPolicy();
  assert.equal(policy.mode,"event_driven_with_recovery_sweep");
  assert.equal(policy.approvalPath,"immediate");
  assert.equal(policy.idleCloudPolling,false);
  assert.equal(policy.coalesced,true);
  assert.equal(policy.idempotent,true);
  assert.ok(policy.recoveryIntervalMs>=30_000);
});

test("natural approval resolves to the continuation tool instead of generic conversation",()=>{
  const utterance="So complete it you have my approval";
  assert.equal(isConversationalApproval(utterance),true);
  assert.deepEqual(deterministicToolPlan(utterance),[{tool:"approvals.continue_latest",args:{utterance}}]);
});

test("ordinary explicit approval language resolves to the latest bounded plan",()=>{
  const approved=[
    "You are approved to fix it",
    "You're approved to repair that.",
    "I approve you to complete the plan now",
    "Go ahead and fix it, you are approved to do so"
  ];
  for(const utterance of approved){
    assert.equal(isConversationalApproval(utterance),true,utterance);
    assert.deepEqual(deterministicToolPlan(utterance),[{tool:"approvals.continue_latest",args:{utterance}}],utterance);
  }
});

test("non-approval language cannot execute a pending plan",()=>{
  for(const utterance of ["Can you fix it?","You should fix it","I want this fixed","Go ahead and inspect it"]){
    assert.equal(isConversationalApproval(utterance),false,utterance);
  }
});

test("an explicit approval cannot recover a plan that was never justified by evidence",()=>{
  const recovered=latestDeterministicApprovalPlan([
    {role:"user",content:"Work through everything pending in our entire Sierra system, prioritize it, and make sure the submission process is functioning and operating as designed."},
    {role:"assistant",content:"Diagnosis completed; the bounded repair remains approval-gated."}
  ]);
  assert.equal(recovered,null);
});

test("preflight names the exact missing execution contract",()=>{
  assert.deepEqual(preflightExecution(null,[{name:"sierra.health"}]),{ok:false,missingTool:"approval.execution_descriptor",reason:"The approved plan has no exact execution tool and bounded arguments."});
  const result=preflightExecution({tool:"developer.apply",verificationTools:["developer.verify"]},[{name:"developer.apply"}]);
  assert.equal(result.ok,false);assert.equal(result.missingTool,"developer.verify");
});

test("verified continuation produces a deterministic evidence-backed completion",()=>{
  const response=sierraWorkflowDirectResponse("approved",[{ok:true,tool:"approvals.continue_latest",result:{ok:true,status:"verified",version:2,approvalId:"approval-1",planId:"plan-1",executedTool:"system.reconciliation_check",result:{lanes:[{lane:"health",status:"observed_only"}]},executionVerification:{accepted:true,state:"PASS",reason:"1 terminal lane"},verification:[{ok:true,accepted:true,state:"PASS",tool:"sierra.health",reason:"healthy",result:{health_status:"healthy"}}]}}]);
  assert.match(response.text,/TASK COMPLETED/);assert.match(response.text,/What I checked/);assert.match(response.text,/What I found/);assert.match(response.text,/What changed/);assert.match(response.text,/What I verified/);assert.match(response.text,/What remains/);assert.match(response.text,/Approval ID: approval-1/);
});

test("successful calls with unknown business evidence are blocked, never completed",()=>{
  const response=sierraWorkflowDirectResponse("approved",[{ok:true,tool:"approvals.continue_latest",result:{ok:false,status:"blocked_incomplete_evidence",version:4,approvalId:"approval-4",planId:"plan-4",executedTool:"system.reconciliation_check",result:{lanes:[{lane:"health",status:"observed_only"}]},executionVerification:{accepted:true,state:"PASS",reason:"terminal"},verification:[{ok:true,accepted:false,state:"UNKNOWN",tool:"sierra.health",reason:"no authoritative healthy status"}]}}]);
  assert.equal(response.completed,false);assert.equal(response.terminalState,"blocked");assert.match(response.text,/NEEDS ATTENTION/);assert.match(response.text,/sierra.health: UNKNOWN/);assert.doesNotMatch(response.text,/TASK COMPLETED/);
});

test("successful calls with unhealthy business evidence are blocked",()=>{
  const response=sierraWorkflowDirectResponse("approved",[{ok:true,tool:"approvals.continue_latest",result:{ok:false,status:"blocked_incomplete_evidence",version:5,executedTool:"system.reconciliation_check",executionVerification:{accepted:true,state:"PASS",reason:"terminal"},verification:[{ok:true,accepted:false,state:"FAIL",tool:"sierra.health",reason:"failed_pipeline_stages: 2"}]}}]);
  assert.equal(response.completed,false);assert.match(response.text,/sierra.health: FAIL/);
});

test("blocked continuation explains the missing capability plainly and never invents a queue",()=>{
  const response=sierraWorkflowDirectResponse("approved",[{ok:true,tool:"approvals.continue_latest",result:{ok:false,status:"blocked_missing_tool",approvalId:"approval-1",planId:"plan-1",missingTool:"developer.verify",error:"Required tool developer.verify is unavailable."}}]);
  assert.match(response.text,/could not continue this action safely/i);assert.match(response.text,/Missing capability: developer.verify/);assert.match(response.text,/What changed: nothing from this attempt/i);assert.doesNotMatch(response.text,/queue|falsely marked complete/i);
});

test("queued reconciliation is reported as in progress, never completed",()=>{
  const response=sierraWorkflowDirectResponse("approved",[{ok:true,tool:"approvals.continue_latest",result:{ok:false,status:"verification_pending",version:3,approvalId:"approval-2",planId:"plan-2",executedTool:"system.reconciliation_check",result:{lanes:[{lane:"intake_transfer",status:"queued"},{lane:"funding_evidence",status:"queued"}]},verification:[{ok:true,tool:"sierra.health"}]}}]);
  assert.equal(response.completed,false);
  assert.equal(response.terminalState,"in_progress");
  assert.match(response.text,/IN PROGRESS/);
  assert.match(response.text,/2 bounded downstream actions were queued/);
  assert.match(response.text,/2 queued actions need terminal execution/);
});
