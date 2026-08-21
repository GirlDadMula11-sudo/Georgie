import test from "node:test";
import assert from "node:assert/strict";
import { classifyExecutionError, executeWithRecovery } from "../src/resilient-execution.js";

test("classifies errors before deciding whether recovery is safe",()=>{assert.deepEqual(classifyExecutionError("provider returned 503 timeout").category,"transient_provider");assert.equal(classifyExecutionError("401 unauthorized").retryable,false);assert.equal(classifyExecutionError("string did not match expected pattern").category,"invalid_request");});

test("transient reads retry once and preserve attempt evidence",async()=>{let calls=0;const result=await executeWithRecovery({action:{tool:"sierra.health",args:{}},userId:"u",policy:"read",risk:"read",timeoutMs:100,execute:async()=>++calls===1?{ok:false,tool:"sierra.health",error:"temporary 503"}:{ok:true,tool:"sierra.health",result:{health_status:"healthy"}}});assert.equal(result.ok,true);assert.equal(result.recovered,true);assert.equal(result.attempts.length,2);});

test("invalid requests do not retry or switch fallbacks",async()=>{let calls=0;const result=await executeWithRecovery({action:{tool:"mac.browser_inspect"},userId:"u",policy:"read",risk:"read",timeoutMs:100,fallback:{tool:"other.read"},execute:async()=>{calls++;return{ok:false,tool:"mac.browser_inspect",error:"The string did not match the expected pattern"};}});assert.equal(calls,1);assert.equal(result.errorCategory,"invalid_request");assert.match(result.exactBlocker,/expected pattern/);});

test("foreground timeout returns durable recovery identity and retains late outcome",async()=>{let late;const result=await executeWithRecovery({action:{tool:"slow.read"},userId:"u",policy:"read",risk:"read",timeoutMs:5,execute:async()=>new Promise(resolve=>setTimeout(()=>resolve({ok:true,tool:"slow.read",result:{value:1}}),20)),onLateResult:value=>{late=value;}});assert.equal(result.ok,false);assert.equal(result.durable,true);assert.ok(result.recoveryId);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(late.result.ok,true);assert.equal(late.recoveryId,result.recoveryId);});
