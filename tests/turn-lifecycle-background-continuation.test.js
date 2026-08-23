import test from "node:test";
import assert from "node:assert/strict";
import { terminalPartialResult, withTurnDeadline } from "../src/turn-lifecycle.js";

test("foreground deadline is a non-terminal automatic continuation",async()=>{
  const startedAt=Date.now();
  let finished=false;
  const operation=withTurnDeadline(async()=>{
    await new Promise(resolve=>setTimeout(resolve,35));
    finished=true;
    return {text:"verified late result",completed:true};
  },{
    timeoutMs:10,
    onDeadline:()=>terminalPartialResult({startedAt})
  });
  const foreground=await operation;
  assert.equal(foreground.completed,false);
  assert.equal(foreground.terminal,false);
  assert.equal(foreground.backgroundContinuation,true);
  assert.match(foreground.text,/continuing automatically/i);
  assert.doesNotMatch(foreground.text,/ask me to continue/i);
  await new Promise(resolve=>setTimeout(resolve,45));
  assert.equal(finished,true);
});

test("provider timeout does not instruct the owner to manually resume",()=>{
  const result=terminalPartialResult({startedAt:Date.now(),reason:"provider_timeout"});
  assert.equal(result.terminal,false);
  assert.equal(result.backgroundContinuation,true);
  assert.match(result.text,/automatic recovery/i);
  assert.doesNotMatch(result.text,/ask me to continue|manually resume/i);
});
