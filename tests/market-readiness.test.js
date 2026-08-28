import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarketReadiness } from "../src/market-readiness.js";

function healthy(overrides={}){return{
  home:{status:200,body:'<section id="enrollmentGate"></section>',headers:{"content-security-policy":"default-src self","x-content-type-options":"nosniff","strict-transport-security":"max-age=1"}},
  manifest:{status:200,body:{display:"standalone",start_url:"/"}},
  health:{status:200,body:{ok:true,ready:true,configured:true,memoryStorage:{durable:true,healthy:true},operationalStorage:{enabled:true,healthy:true,degraded:false,providerCircuitOpen:false,pendingWrites:0,lastSuccessAt:"2026-08-28T17:00:00.000Z"},blockers:[]}},
  readiness:{status:200,body:{ready:true}},unauthorized:{status:401},timings:{health:100},...overrides
};}

test("market readiness passes only a durable, secured, responsive app",()=>assert.deepEqual(evaluateMarketReadiness(healthy()).blockers,[]));
test("market readiness fails closed on unproven durability",()=>{const value=healthy();value.health.body.operationalStorage.lastSuccessAt=null;assert.deepEqual(evaluateMarketReadiness(value).blockers,["durable_operational_state_unhealthy"]);});
test("market readiness rejects an exposed device route",()=>assert.ok(evaluateMarketReadiness(healthy({unauthorized:{status:200}})).blockers.includes("device_auth_not_fail_closed")));
test("market readiness enforces the five-second smoke budget",()=>assert.ok(evaluateMarketReadiness(healthy({timings:{health:5001}})).blockers.includes("latency_budget_exceeded:health")));
