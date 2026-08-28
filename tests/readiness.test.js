import test from "node:test";
import assert from "node:assert/strict";
import { buildReadinessSnapshot, readinessHttpStatus } from "../src/readiness.js";

function baseline(overrides={}){
  return buildReadinessSnapshot({
    openAI:true,
    neoMail:false,
    sierraWorkforce:true,
    macAgent:false,
    memoryStorage:{durable:true,healthy:true},
    operationalStorage:{enabled:true,healthy:true,degraded:false,providerCircuitOpen:false,lastSuccessAt:"2026-08-28T17:00:00.000Z"},
    macQueue:{mode:"durable"},
    runtimeMode:"kernel",
    ...overrides
  });
}

test("readiness succeeds only when both durable stores are healthy",()=>{
  const snapshot=baseline();
  assert.equal(snapshot.ready,true);
  assert.equal(readinessHttpStatus(snapshot),200);
  assert.deepEqual(snapshot.blockers,[]);
});

test("degraded operational storage fails readiness instead of reporting a false green",()=>{
  const snapshot=baseline({operationalStorage:{enabled:true,healthy:false,degraded:true,lastError:"fetch failed",providerCircuitOpen:true}});
  assert.equal(snapshot.ready,false);
  assert.equal(snapshot.activationState,"connection_pending");
  assert.equal(readinessHttpStatus(snapshot),503);
  assert.deepEqual(snapshot.blockers,["durable_operational_state_degraded"]);
});

test("unhealthy durable memory fails readiness",()=>{
  const snapshot=baseline({memoryStorage:{durable:true,healthy:false,lastError:"timeout"}});
  assert.equal(snapshot.ready,false);
  assert.equal(readinessHttpStatus(snapshot),503);
  assert.deepEqual(snapshot.blockers,["durable_memory_degraded"]);
});

test("configured operational storage remains unready until a live read succeeds",()=>{
  const snapshot=baseline({operationalStorage:{enabled:true,healthy:true,degraded:false,providerCircuitOpen:false,lastSuccessAt:null}});
  assert.equal(snapshot.ready,false);
  assert.equal(readinessHttpStatus(snapshot),503);
  assert.deepEqual(snapshot.blockers,["durable_operational_state_unverified"]);
});
