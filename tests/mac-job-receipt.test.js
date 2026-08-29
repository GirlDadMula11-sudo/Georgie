import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { verifiedDirectResponse } from "../src/v2-turn-engine.js";

const jobId="idem-2b5c6016aec13c3e305a7a85c81087c0d6668633";

test("exact completed receipt request is read-only and never reruns the job",()=>{
  assert.deepEqual(deterministicToolPlan(`Report the completed receipt for Mac job ${jobId}, including its Prototype.rbxlx artifact path and Roblox Studio open result. Do not create or execute anything.`),[{tool:"mac.job_receipt",args:{jobId}}]);
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
