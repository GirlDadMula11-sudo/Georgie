import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { verifiedDirectResponse } from "../src/v2-turn-engine.js";

const jobId="idem-2b5c6016aec13c3e305a7a85c81087c0d6668633";
const recoveryJobId="idem-0505ad1acfe35898ed8f1f95e492777965ab78dd";

test("exact completed receipt request is read-only and never reruns the job",()=>{
  assert.deepEqual(deterministicToolPlan(`Report the completed receipt for Mac job ${jobId}, including its Prototype.rbxlx artifact path and Roblox Studio open result. Do not create or execute anything.`),[{tool:"mac.job_receipt",args:{jobId}}]);
});

test("read-only checkpoint lookup with prohibitions cannot create a recovery plan",()=>{
  assert.deepEqual(deterministicToolPlan(`Read-only status reconciliation. Inspect exact durable Mac job ${recoveryJobId}. Do not enqueue, restart, retry, create, approve, or execute any job. Return its current status, attempts, claim lease, checkpoints, and error.`),[{tool:"mac.job_receipt",args:{jobId:recoveryJobId}}]);
});

test("exact long-running recovery marker prepares one identity-preserving plan",()=>{
  const marker=`MAC_LONG_RUNNING_RECOVERY_JSON: ${JSON.stringify({jobId:recoveryJobId,deviceId:"primary-mac",expectedAction:"roblox.install_rojo_and_build",requiredAgentVersion:"2.2.62"})}`;
  const [action]=deterministicToolPlan(marker);
  assert.equal(action.tool,"approvals.prepare_plan");
  assert.deepEqual(action.args.execution.args,{jobId:recoveryJobId,deviceId:"primary-mac",expectedAction:"roblox.install_rojo_and_build",requiredAgentVersion:"2.2.62"});
  assert.deepEqual(action.args.execution.verification.map(item=>item.tool),["mac.job_receipt","mac.devices"]);
  assert.match(action.args.summary,/never enqueue another Roblox job/i);
});

test("long-running recovery marker rejects any scope expansion",()=>{
  for(const request of [
    {jobId:recoveryJobId,deviceId:"secondary-mac",expectedAction:"roblox.install_rojo_and_build",requiredAgentVersion:"2.2.62"},
    {jobId:recoveryJobId,deviceId:"primary-mac",expectedAction:"roblox.install_rojo_and_build",requiredAgentVersion:"2.2.41"},
    {jobId:recoveryJobId,deviceId:"primary-mac",expectedAction:"roblox.create_job",requiredAgentVersion:"2.2.62"}
  ]) assert.deepEqual(deterministicToolPlan(`MAC_LONG_RUNNING_RECOVERY_JSON: ${JSON.stringify(request)}`),[]);
});

test("multiple exact job lookups and heartbeat remain entirely read-only",()=>{
  assert.deepEqual(deterministicToolPlan(`Read-only: inspect ${recoveryJobId} and ${jobId}, then return heartbeat and agent version. Never resume or execute either job.`),[{tool:"mac.job_receipt",args:{jobId:recoveryJobId}},{tool:"mac.job_receipt",args:{jobId}},{tool:"mac.devices",args:{}}]);
});

test("Rojo installation and resume command cannot be swallowed by receipt lookup",()=>{
  const [action]=deterministicToolPlan(`Permanently install and verify Rojo CLI, then resume the preserved Roblox prototype from job ${jobId} and return the artifact receipt.`);
  assert.equal(action.tool,"approvals.prepare_plan");
  assert.equal(action.args.execution.tool,"roblox.update_agent_install_and_build");
});

test("exact Roblox receipt reports artifact and Studio evidence",()=>{
  const response=verifiedDirectResponse("report receipt",[{ok:true,tool:"mac.job_receipt",result:{id:jobId,action:"roblox.prototype_build",status:"completed",result:{status:"completed",output:"/Users/mac/GeorgieRoblox/Makayla/Prototype.rbxlx",outputBytes:12345,openedInStudio:true}}}]);
  assert.match(response.text,/Prototype: \/Users\/mac\/GeorgieRoblox\/Makayla\/Prototype\.rbxlx/);
  assert.match(response.text,/Artifact bytes: 12345/);
  assert.match(response.text,/Roblox Studio opened: yes/);
  assert.equal(response.terminalState,"verified");
});

test("wrapper completion without a verified inner artifact remains blocked",()=>{
  const response=verifiedDirectResponse("report receipt",[{ok:true,tool:"mac.job_receipt",result:{id:jobId,action:"roblox.prototype_build",status:"completed",result:{status:"blocked_tooling",missingPrecondition:"Rojo CLI",preserved:true}}}]);
  assert.equal(response.terminalState,"blocked");
  assert.match(response.text,/Exact blocker: Rojo CLI/);
});
