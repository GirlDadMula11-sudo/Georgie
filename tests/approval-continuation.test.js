import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { isConversationalApproval, preflightExecution } from "../src/approval-continuation.js";
import { sierraWorkflowDirectResponse } from "../src/sierra-workflow-summary.js";

test("natural approval resolves to the continuation tool instead of generic conversation",()=>{
  const utterance="So complete it you have my approval";
  assert.equal(isConversationalApproval(utterance),true);
  assert.deepEqual(deterministicToolPlan(utterance),[{tool:"approvals.continue_latest",args:{utterance}}]);
});

test("preflight names the exact missing execution contract",()=>{
  assert.deepEqual(preflightExecution(null,[{name:"sierra.health"}]),{ok:false,missingTool:"approval.execution_descriptor",reason:"The approved plan has no exact execution tool and bounded arguments."});
  const result=preflightExecution({tool:"developer.apply",verificationTools:["developer.verify"]},[{name:"developer.apply"}]);
  assert.equal(result.ok,false);assert.equal(result.missingTool,"developer.verify");
});

test("verified continuation produces a deterministic evidence-backed completion",()=>{
  const response=sierraWorkflowDirectResponse("approved",[{ok:true,tool:"approvals.continue_latest",result:{ok:true,status:"verified",version:2,approvalId:"approval-1",planId:"plan-1",executedTool:"developer.apply"}}]);
  assert.match(response.text,/executed and verified/);assert.match(response.text,/Approval ID: approval-1/);
});

test("blocked continuation names the missing tool and never invents a queue",()=>{
  const response=sierraWorkflowDirectResponse("approved",[{ok:true,tool:"approvals.continue_latest",result:{ok:false,status:"blocked_missing_tool",approvalId:"approval-1",planId:"plan-1",missingTool:"developer.verify",error:"Required tool developer.verify is unavailable."}}]);
  assert.match(response.text,/Exact missing tool: developer.verify/);assert.match(response.text,/Nothing was queued or completed/);
});
