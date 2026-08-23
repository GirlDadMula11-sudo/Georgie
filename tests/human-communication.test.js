import test from "node:test";
import assert from "node:assert/strict";
import { sierraWorkflowDirectResponse } from "../src/sierra-workflow-summary.js";

test("unrecognized approval is explained without machine-state jargon",()=>{
  const response=sierraWorkflowDirectResponse("",[{tool:"approvals.continue_latest",ok:true,result:{ok:false,status:"not_an_approval",error:"The utterance was not explicit approval."}}]);
  assert.match(response.text,/did not recognize that message as approval/i);
  assert.match(response.text,/did not start anything/i);
  assert.doesNotMatch(response.text,/not_an_approval|BLOCKED|not returned|falsely marked complete/i);
});

test("missing plan tells Jason plainly that there is nothing to approve",()=>{
  const response=sierraWorkflowDirectResponse("",[{tool:"approvals.continue_latest",ok:true,result:{ok:false,status:"no_eligible_plan",error:"No eligible plan."}}]);
  assert.match(response.text,/no valid repair plan ready for approval/i);
  assert.match(response.text,/nothing started/i);
  assert.doesNotMatch(response.text,/no_eligible_plan|Approval ID: not returned|Plan ID: not returned/i);
});

test("technical failure leads with meaning and keeps identifiers in details",()=>{
  const response=sierraWorkflowDirectResponse("",[{tool:"approvals.continue_latest",ok:true,result:{ok:false,status:"blocked_missing_tool",error:"Required browser capability is unavailable.",missingTool:"mac.browser_workflow",approvalId:"approval-1",planId:"plan-1"}}]);
  assert.match(response.text,/could not continue this action safely/i);
  assert.match(response.text,/What changed: nothing from this attempt/i);
  assert.match(response.text,/Details:/);
  assert.doesNotMatch(response.text,/^BLOCKED/m);
});
