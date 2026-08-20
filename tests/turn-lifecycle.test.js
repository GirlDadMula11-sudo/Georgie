import test from "node:test";
import assert from "node:assert/strict";
import { terminalPartialResult, withTurnDeadline } from "../src/turn-lifecycle.js";

test("a stalled turn always returns a terminal partial result",async()=>{
  const result=await withTurnDeadline(()=>new Promise(()=>{}),{timeoutMs:20,onDeadline:()=>terminalPartialResult({startedAt:Date.now()-20})});
  assert.equal(result.terminal,true);
  assert.equal(result.completed,false);
  assert.equal(result.confidence,"partial_unverified");
  assert.match(result.text,/not treated it as completed/i);
});

test("a completed turn wins before the deadline",async()=>{
  const result=await withTurnDeadline(async()=>({terminal:true,completed:true,text:"verified"}),{timeoutMs:100,onDeadline:()=>terminalPartialResult()});
  assert.equal(result.completed,true);
  assert.equal(result.text,"verified");
});

test("terminal partial language never claims execution",()=>{
  const result=terminalPartialResult({startedAt:Date.now()});
  assert.doesNotMatch(result.text,/successfully completed|repair completed|fixed/i);
  assert.equal(result.terminalReason,"turn_deadline");
});

test("provider timeout returns a durable terminal recovery result",()=>{
  const result=terminalPartialResult({startedAt:Date.now()-24,reason:"provider_timeout",detail:"The operation was aborted due to timeout"});
  assert.equal(result.completed,false);
  assert.equal(result.terminal,true);
  assert.equal(result.terminalReason,"provider_timeout");
  assert.match(result.text,/accepted and preserved/i);
  assert.match(result.text,/without restating/i);
  assert.doesNotMatch(result.text,/completed successfully/i);
});
