import test from "node:test";
import assert from "node:assert/strict";
import { buildImmutableExecutionPlan, verifyImmutableExecutionPlan, immutableExecutionPlanContract } from "../src/immutable-execution-plan.js";

test("planner freezes exact governed tools args risk and hash",async()=>{
  const result=await buildImmutableExecutionPlan({text:"What are we working on?"},{specialist:{id:"monitoring-recovery",role:"monitoring_recovery"},acceptanceCriteria:["Return explicit terminal status"]});
  assert.equal(result.status,"planned");
  assert.match(result.planHash,/^[0-9a-f]{64}$/);
  assert.ok(result.plan.steps.length>=1);
  assert.ok(result.plan.steps.every(step=>step.tool&&step.risk));
  assert.equal(result.plan.verification.allowMidFlightReplan,false);
  assert.equal(verifyImmutableExecutionPlan(result.plan,result.planHash).ok,true);
});

test("any post-plan argument mutation invalidates the hash",async()=>{
  const result=await buildImmutableExecutionPlan({text:"What are we working on?"});
  const mutated=structuredClone(result.plan);
  mutated.steps[0].args={...(mutated.steps[0].args||{}),unexpectedScopeExpansion:true};
  const check=verifyImmutableExecutionPlan(mutated,result.planHash);
  assert.equal(check.ok,false);
  assert.notEqual(check.actualHash,result.planHash);
});

test("immutable execution contract forbids mid-flight replan and scope expansion",()=>{
  const contract=immutableExecutionPlanContract();
  assert.equal(contract.midFlightReplan,false);
  assert.equal(contract.scopeExpansion,false);
  assert.equal(contract.canonicalJsonHash,"sha256");
});
