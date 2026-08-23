import test from "node:test";
import assert from "node:assert/strict";
import { evaluateVerificationContract, seedMissionWork } from "../src/engineering-coordinator.js";

test("mission seeding is idempotent and preserves the locked attack order",async()=>{
  process.env.GEORGIE_CLOUD_STATE_ENABLED="false";
  const uid=`mission-test-${Date.now()}`;
  const first=await seedMissionWork(uid),second=await seedMissionWork(uid);
  assert.equal(first.length,9);assert.equal(second.every(item=>item.status==="deduplicated"),true);
  assert.equal(first[0].item.priority,100);
  assert.match(first[1].item.objective,/Canonical document identity/i);
  assert.match(first[7].item.objective,/CapitalMatch accuracy/i);
  assert.deepEqual(first[0].item.dependsOn,[]);
  assert.deepEqual(first.slice(1).map(result=>result.item.dependsOn.length),[1,1,1,1,1,1,1,1]);
});

test("semantic verification fails closed on verified false and missing predicates",()=>{
  assert.deepEqual(evaluateVerificationContract({tool:"provider.verify"},{ok:true,result:{verified:false,member:null}}),{required:true,satisfied:false,mode:"verified_flag",reason:"verified_flag_false"});
  assert.equal(evaluateVerificationContract({tool:"provider.verify"},{ok:true,result:{verified:true}}).satisfied,true);
  assert.equal(evaluateVerificationContract({tool:"provider.verify"},{ok:true,result:{member:{role:"DEVELOPER"}}}).satisfied,false);
  assert.equal(evaluateVerificationContract({tool:"provider.verify"},{ok:false,error:"timeout"}).reason,"verification_transport_failed");
});

test("declared verification expect contract is matched semantically as a subset",()=>{
  const spec={tool:"provider.read",expect:{member:{role:"DEVELOPER"},verified:true}};
  assert.equal(evaluateVerificationContract(spec,{ok:true,result:{verified:true,member:{role:"DEVELOPER",email:"person@example.com"},extra:"ignored"}}).satisfied,true);
  assert.equal(evaluateVerificationContract(spec,{ok:true,result:{verified:true,member:{role:"VIEWER"}}}).satisfied,false);
});
