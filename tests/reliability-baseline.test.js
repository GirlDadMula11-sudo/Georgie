import test from "node:test";
import assert from "node:assert/strict";
import { assertReliabilityBaseline, RELIABILITY_BASELINE } from "../src/reliability-baseline.js";

function cleanObservations(){
  return RELIABILITY_BASELINE.requiredCases.flatMap((name)=>[0,1].map((cycle)=>({case:name,cycle,completed:true,terminalState:"verified",latencyMs:1200,usefulResponse:true,plannerLimbo:false,manualResumeRequired:false,staleClientState:false})));
}

test("known-good 20-turn baseline passes",()=>{
  const observations=cleanObservations();
  const result={observations,certification:{certified:true,sampleSize:20,failures:[]}};
  assert.equal(assertReliabilityBaseline(result).ok,true);
});

test("a single reliability regression blocks the baseline",()=>{
  const observations=cleanObservations();
  observations[3]={...observations[3],completed:false,terminalState:"failed",usefulResponse:false,plannerLimbo:true};
  const result={observations,certification:{certified:false,sampleSize:20,failures:[{index:3,reason:"planner_limbo"}]}};
  assert.throws(()=>assertReliabilityBaseline(result),(error)=>error?.code==="RELIABILITY_BASELINE_REGRESSION"&&error.failures.includes("planner_limbo"));
});

test("latency over 15 seconds fails closed",()=>{
  const observations=cleanObservations();
  observations[0]={...observations[0],latencyMs:15001};
  const result={observations,certification:{certified:false,sampleSize:20,failures:[{index:0,reason:"latency"}]}};
  assert.throws(()=>assertReliabilityBaseline(result),/latency_regression/);
});
