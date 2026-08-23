import test from "node:test";
import assert from "node:assert/strict";
import { SHARED_MISSION, autonomousRepairPolicy, claimNextHandoff, completeHandoff, enqueueHandoff } from "../src/shared-mission.js";

test("shared mission keeps Sierra integrity gates ahead of CapitalMatch accuracy",()=>{
  const joined=SHARED_MISSION.priorities.join("\n");
  assert.ok(joined.indexOf("document identity")<joined.indexOf("CapitalMatch"));
  assert.match(SHARED_MISSION.completionStandard,/authoritative evidence/i);
  assert.ok(SHARED_MISSION.authority.approvalRequired.includes("production_deploy"));
});

test("hard-gated work cannot be claimed before its prerequisite passes",async()=>{
  const user=`gate-${Date.now()}`;
  const first=await enqueueHandoff(user,{objective:"First gate",dedupeKey:"gate:first",priority:100});
  await enqueueHandoff(user,{objective:"Second gate",dedupeKey:"gate:second",dependsOn:["gate:first"],priority:99});
  const claimedFirst=await claimNextHandoff(user,"test");assert.equal(claimedFirst.id,first.item.id);
  assert.equal(await claimNextHandoff(user,"test"),null);
  await completeHandoff(user,claimedFirst.id,{summary:"passed"});
  const claimedSecond=await claimNextHandoff(user,"test");assert.equal(claimedSecond.dedupeKey,"gate:second");
});

test("only verified reversible isolated-branch repairs qualify for automatic commit",()=>{
  const eligible=autonomousRepairPolicy({risk:"write",files:["src/parser.js","tests/parser.test.js"],checks:[{status:"passed"}],reversible:true,rollbackPlan:"Revert commit",branch:"repair/parser",customerDataChanged:false,externalSideEffect:false});
  assert.equal(eligible.eligible,true);assert.equal(eligible.action,"commit_to_isolated_branch");assert.equal(eligible.mergeToMain,false);
  for(const unsafe of [
    {risk:"high",files:["src/parser.js"],checks:[{status:"passed"}],reversible:true,rollbackPlan:"revert",branch:"repair/x"},
    {risk:"write",files:["supabase/migrations/1.sql"],checks:[{status:"passed"}],reversible:true,rollbackPlan:"down",branch:"repair/x"},
    {risk:"write",files:["src/parser.js"],checks:[{status:"failed"}],reversible:true,rollbackPlan:"revert",branch:"repair/x"},
    {risk:"write",files:["src/parser.js"],checks:[{status:"passed"}],reversible:true,rollbackPlan:"revert",branch:"main"}
  ])assert.equal(autonomousRepairPolicy(unsafe).eligible,false);
});
