import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryTokenLedger, estimateModelTokens, modelTokenLimits } from "../src/model-cost-governor.js";

test("token limits are configurable and ordered",()=>{
  const limits=modelTokenLimits({GEORGIE_MODEL_TOKENS_PER_REQUEST:"100",GEORGIE_MODEL_TOKENS_PER_HOUR:"500",GEORGIE_MODEL_TOKENS_PER_DAY:"1000"});
  assert.deepEqual(limits,{perRequest:100,perHour:500,perDay:1000});
});

test("reservation fails before a per-request ceiling can be exceeded",async()=>{
  const ledger=createMemoryTokenLedger({limits:{perRequest:100,perHour:500,perDay:1000}});
  await assert.rejects(ledger.reserve({reservedTokens:101}),error=>error.code==="model_cost_request_token_cap");
  assert.equal(ledger.rows.size,0);
});

test("atomic reservations enforce shared hourly and daily ceilings",async()=>{
  let now=Date.parse("2026-08-30T12:00:00Z");
  const ledger=createMemoryTokenLedger({limits:{perRequest:100,perHour:150,perDay:200},now:()=>now});
  await ledger.reserve({reservationId:"one",reservedTokens:100});
  await assert.rejects(ledger.reserve({reservationId:"two",reservedTokens:60}),error=>error.code==="model_cost_hour_token_cap");
  now+=3_600_001;
  await ledger.reserve({reservationId:"three",reservedTokens:100});
  await assert.rejects(ledger.reserve({reservationId:"four",reservedTokens:1}),error=>error.code==="model_cost_day_token_cap");
});

test("reconciliation releases unused reserved tokens and retains telemetry",async()=>{
  const ledger=createMemoryTokenLedger({limits:{perRequest:100,perHour:150,perDay:200}});
  await ledger.reserve({reservationId:"one",reservedTokens:100,model:"luna",objectiveId:"obj-1"});
  const row=await ledger.reconcile({reservationId:"one",actualTokens:25,latencyMs:12,qualityResult:"passed"});
  assert.equal(row.actualTokens,25);
  assert.equal(row.objectiveId,"obj-1");
  assert.equal(row.qualityResult,"passed");
  assert.equal(ledger.status().hourTokens,25);
});

test("token estimation reserves bounded output before provider execution",()=>{
  const value=estimateModelTokens({body:{input:"12345678"},maxOutputTokens:20});
  assert.equal(value.outputTokens,20);
  assert.ok(value.inputTokens>=1);
  assert.equal(value.totalTokens,value.inputTokens+20);
});
