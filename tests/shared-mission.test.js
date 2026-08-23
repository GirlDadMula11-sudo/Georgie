import test from "node:test";
import assert from "node:assert/strict";
import { SHARED_MISSION, autonomousRepairPolicy, claimNextHandoff, completeHandoff, enqueueHandoff, listHandoffs } from "../src/shared-mission.js";

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
  const blocked=await listHandoffs(user,{status:"all"});assert.equal(blocked.items.find(item=>item.dedupeKey==="gate:second").status,"blocked_by_dependency");
  await completeHandoff(user,claimedFirst.id,{summary:"passed"});
  const claimedSecond=await claimNextHandoff(user,"test");assert.equal(claimedSecond.dedupeKey,"gate:second");
});

test("typed control dependencies resolve canonical dedupe keys and command IDs",async()=>{
  for(const dependency of ["ai-control:preflight-key","preflight-command-001"]){
    const user=`typed-gate-${dependency.includes("command")?"command":"dedupe"}-${Date.now()}-${Math.random()}`;
    const preflight=await enqueueHandoff(user,{source:"authorized_assistant_control_command",objective:"preflight",dedupeKey:"ai-control:preflight-key",priority:100,scope:{controlCommand:{commandId:"preflight-command-001",idempotencyKey:"preflight-key"}}});
    await enqueueHandoff(user,{source:"authorized_assistant_control_command",objective:"mutation",dedupeKey:"ai-control:mutation-key",dependsOn:[dependency],priority:99,scope:{controlCommand:{commandId:"mutation-command-001",idempotencyKey:"mutation-key"}}});
    const claimedPreflight=await claimNextHandoff(user,"test");assert.equal(claimedPreflight.id,preflight.item.id);
    assert.equal(await claimNextHandoff(user,"test"),null);
    await completeHandoff(user,claimedPreflight.id,{summary:"passed"});
    const claimedMutation=await claimNextHandoff(user,"test");assert.equal(claimedMutation.dedupeKey,"ai-control:mutation-key");
  }
});

test("exact duplicate typed-command replay collapses by canonical idempotency key",async()=>{
  const user=`typed-replay-${Date.now()}`;
  const input={source:"authorized_assistant_control_command",objective:"same command",dedupeKey:"ai-control:exact-replay-key",scope:{controlCommand:{commandId:"replay-command-001",idempotencyKey:"exact-replay-key"}}};
  const first=await enqueueHandoff(user,input),second=await enqueueHandoff(user,input);
  assert.equal(first.status,"queued");assert.equal(second.status,"deduplicated");assert.equal(second.item.id,first.item.id);
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
