import test from "node:test";
import assert from "node:assert/strict";
import { terminalPartialResult, withTurnDeadline } from "../src/turn-lifecycle.js";
import { interruptedStreamRecoveryContext } from "../src/georgie.js";

test("a stalled foreground response remains a durable non-terminal continuation",async()=>{
  const result=await withTurnDeadline(()=>new Promise(()=>{}),{timeoutMs:20,onDeadline:()=>terminalPartialResult({startedAt:Date.now()-20})});
  assert.equal(result.terminal,false);
  assert.equal(result.foregroundTerminated,true);
  assert.equal(result.backgroundContinuation,true);
  assert.equal(result.completed,false);
  assert.equal(result.confidence,"partial_unverified");
  assert.equal(result.text,"Still working on this. No action is needed from you.");
});

test("a completed turn wins before the deadline",async()=>{
  const result=await withTurnDeadline(async()=>({terminal:true,completed:true,text:"verified"}),{timeoutMs:100,onDeadline:()=>terminalPartialResult()});
  assert.equal(result.completed,true);
  assert.equal(result.text,"verified");
});

test("a durable streaming turn is not preempted by the synchronous deadline",async()=>{
  const result=await withTurnDeadline(
    ()=>new Promise(resolve=>setTimeout(()=>resolve({terminal:true,completed:true,text:"late verified result"}),25)),
    {timeoutMs:null,onDeadline:()=>terminalPartialResult()}
  );
  assert.equal(result.completed,true);
  assert.equal(result.text,"late verified result");
});

test("foreground partial language never claims execution or exposes lifecycle jargon",()=>{
  const result=terminalPartialResult({startedAt:Date.now()});
  assert.doesNotMatch(result.text,/successfully completed|repair completed|fixed|foreground|deadline|persistence|unfinished|terminal/i);
  assert.equal(result.terminalReason,"turn_deadline");
  assert.equal(result.terminalScope,"foreground_response_only");
});

test("provider timeout returns a durable automatic recovery result",()=>{
  const result=terminalPartialResult({startedAt:Date.now()-24,reason:"provider_timeout",detail:"The operation was aborted due to timeout"});
  assert.equal(result.completed,false);
  assert.equal(result.terminal,false);
  assert.equal(result.foregroundTerminated,true);
  assert.equal(result.backgroundContinuation,true);
  assert.equal(result.terminalReason,"provider_timeout");
  assert.match(result.text,/still working on this/i);
  assert.match(result.text,/continue automatically/i);
  assert.doesNotMatch(result.text,/completed successfully|ask me to continue|manually resume|foreground|provider timeout|retained|unfinished|persistence/i);
});

test("interrupted intelligence is recovered with a bounded continuation",()=>{
  const context=interruptedStreamRecoveryContext("live evidence","already-visible draft");
  assert.match(context,/do not repeat the draft/i);
  assert.match(context,/under 350 words/i);
  assert.match(context,/already-visible draft/);
  assert.match(context,/never claim an unverified action/i);
});
