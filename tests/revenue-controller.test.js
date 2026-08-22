import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { buildRevenueControllerSnapshot } from "../src/revenue-controller.js";
import { sierraWorkflowDirectResponse } from "../src/sierra-workflow-summary.js";

test("progressive activation deterministically starts Phase 1",()=>{
  assert.deepEqual(deterministicToolPlan("Activate it progressively."),[{tool:"system.revenue_controller_activate",args:{phase:1}}]);
});

test("healthy broad Sierra execution never invents an approval plan",()=>{
  const plan=deterministicToolPlan("Fix and stabilize our entire Sierra system end-to-end");
  assert.equal(plan.some(item=>item.tool==="approvals.prepare_plan"),false);
  assert.equal(plan.find(item=>item.tool==="sierra.portfolio")?.args?.limit,100);
});

test("Phase 1 assigns every returned deal and preserves authority gates",()=>{
  const snapshot=buildRevenueControllerSnapshot({portfolio:[
    {reference_number:"SCA-1",legal_business_name:"Alpha",current_stage:"underwriting",stage_status:"waiting_system",attention_score:25,next_action:"Automated underwriting in progress"},
    {reference_number:"SCA-2",legal_business_name:"Beta",current_stage:"selection",stage_status:"waiting_human",attention_score:75,next_action:"Jason or Louri: select lender(s)",submitted_lender_count:1,available_offers:1}
  ],health:{metrics:{failed_pipeline_stages:0}},infrastructure:{sierra_core:{stale_automation:0}},reconciliation:{exceptions:0,completeness_proven:true,authoritative_capitalapply_pass:true,sierra_observed_pass:true}});
  assert.equal(snapshot.coverage.assignedDeals,2);
  assert.equal(snapshot.coverage.waitingSystem,1);
  assert.equal(snapshot.coverage.waitingHuman,1);
  assert.equal(snapshot.assignments[0].reference,"SCA-2");
  assert.equal(snapshot.gates.lenderSubmission,"approval_required");
  assert.equal(snapshot.controls.reconciliationProven,true);
});

test("activation response is executive-readable and names locked phases",()=>{
  const response=sierraWorkflowDirectResponse("Activate it progressively",[{ok:true,tool:"system.revenue_controller_activate",result:{coverage:{assignedDeals:27,waitingSystem:9,waitingHuman:11,lenderSubmitted:4,offersAvailable:2},controls:{pipelineFailures:0,reconciliationExceptions:0,reconciliationProven:true},assignments:[{business:"Alpha",reference:"SCA-1",nextAction:"Complete underwriting"}]}}]);
  assert.match(response.text,/PHASE 1 ACTIVATED/);
  assert.match(response.text,/assigned to 27/);
  assert.match(response.text,/Phase 2.*locked/i);
  assert.match(response.text,/Phase 3.*locked/i);
  assert.doesNotMatch(response.text,/approval plan/i);
});
