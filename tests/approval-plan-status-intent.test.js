import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { verifiedDirectResponse } from "../src/v2-turn-engine.js";

const planId="b923973f-34fe-4063-b256-45c9c1e2bdd4";

test("exact approval plan status never routes to investigation retrieval",()=>{
  const actions=deterministicToolPlan(`Check the current status of plan ${planId} and report its Mac-agent and Roblox-build receipts. Do not create a new plan.`);
  assert.deepEqual(actions.map(item=>item.tool),["approvals.plans","mac.jobs"]);
});

test("exact approval plan status reports the durable plan and build receipt",()=>{
  const response=verifiedDirectResponse(`Check status of plan ${planId} and report receipts.`,[
    {ok:true,tool:"approvals.plans",result:[{id:planId,approvalId:"approval-1",status:"verification_pending",executionResult:{requiredAgentVersion:"2.2.37",update:{status:"completed"},build:{status:"queued"}}}]},
    {ok:true,tool:"mac.jobs",result:[{id:"job-1",planId,status:"queued",action:"roblox.prototype_build"}]}
  ]);
  assert.match(response.text,/Mac-agent update: completed/);
  assert.match(response.text,/Roblox build: queued/);
  assert.equal(response.terminalState,"in_progress");
});
