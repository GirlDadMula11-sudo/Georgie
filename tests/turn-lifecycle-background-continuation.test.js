import test from "node:test";
import assert from "node:assert/strict";
import { terminalPartialResult, withTurnDeadline } from "../src/turn-lifecycle.js";

const INTERNAL_LANGUAGE=/foreground|response window|deadline|retained|persistence|unfinished|terminal|provider timeout|ask me to continue|manually resume/i;

test("foreground deadline is a non-terminal automatic continuation with human-only status",async()=>{
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
  assert.equal(foreground.text,"Still working on this. No action is needed from you.");
  assert.doesNotMatch(foreground.text,INTERNAL_LANGUAGE);
  await new Promise(resolve=>setTimeout(resolve,45));
  assert.equal(finished,true);
});

test("provider timeout stays automatic without exposing lifecycle jargon",()=>{
  const result=terminalPartialResult({startedAt:Date.now(),reason:"provider_timeout"});
  assert.equal(result.terminal,false);
  assert.equal(result.backgroundContinuation,true);
  assert.match(result.text,/still working on this/i);
  assert.match(result.text,/continue automatically/i);
  assert.doesNotMatch(result.text,INTERNAL_LANGUAGE);
});
