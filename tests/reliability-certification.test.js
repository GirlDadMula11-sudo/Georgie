import test from "node:test";
import assert from "node:assert/strict";
import {certifyReliability,reliabilityCertificationPlan} from "../src/reliability-certification.js";

test("twenty clean mixed-domain turns certify basic reliability",()=>{
 const rows=Array.from({length:20},()=>({completed:true,terminalState:"verified",latencyMs:1200,usefulResponse:true}));
 const result=certifyReliability(rows);
 assert.equal(result.certified,true);
 assert.equal(result.blocksMarketDataActivation,false);
});

test("one still-working or manual-resume failure blocks promotion",()=>{
 const rows=Array.from({length:20},()=>({completed:true,terminalState:"verified",latencyMs:1200,usefulResponse:true}));
 rows[7]={completed:false,terminalState:"working",latencyMs:4900,usefulResponse:false,plannerLimbo:true,manualResumeRequired:true};
 const result=certifyReliability(rows);
 assert.equal(result.certified,false);
 assert.equal(result.blocksMarketDataActivation,true);
 assert.ok(result.failures.length>=3);
});

test("market sophistication is explicitly downstream of reliability",()=>{
 assert.deepEqual(reliabilityCertificationPlan().promotionOrder,["reliability","market_data_credentials","fresh_market_observation","continuous_paper_trading"]);
});
