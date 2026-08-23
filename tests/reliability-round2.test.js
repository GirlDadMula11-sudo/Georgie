import test from "node:test";
import assert from "node:assert/strict";
import { reliabilityFastResponse } from "../src/reliability-fast-paths.js";

test("direct answer is immediate and useful",()=>{
 const result=reliabilityFastResponse("Can you answer this immediately without creating a long-running task?");
 assert.equal(result?.completed,true);
 assert.ok(result.text.length>60);
 assert.match(result.text,/ordinary questions immediately/i);
});

test("Sierra completion policy uses bounded deterministic response",()=>{
 const result=reliabilityFastResponse("In Sierra operations, what should be checked before calling a funding file complete?");
 assert.equal(result?.completed,true);
 assert.equal(result?.route?.domain,"sierra");
 assert.match(result.text,/actual funding evidence/i);
 assert.match(result.text,/reconciled/i);
});
