import test from "node:test";
import assert from "node:assert/strict";
import { neoRetryDelayMs, neoRetryDue, recordNeoFailure } from "../src/email-worker.js";

test("NEO failures back off exponentially with a six-hour ceiling",()=>{
  assert.equal(neoRetryDelayMs(1),5*60_000);
  assert.equal(neoRetryDelayMs(2),10*60_000);
  assert.equal(neoRetryDelayMs(20),6*60*60_000);
});

test("NEO failure checkpoints survive sweeps and become due only at their deadline",()=>{
  const failures={},at=Date.parse("2026-08-27T03:00:00Z");
  const first=recordNeoFailure(failures,"work",48067,"provider timeout",at);
  assert.equal(first.attempts,1);
  assert.equal(neoRetryDue(first,at+299_999),false);
  assert.equal(neoRetryDue(first,at+300_000),true);
  const second=recordNeoFailure(failures,"work",48067,"provider timeout",at+300_000);
  assert.equal(second.attempts,2);
  assert.equal(second.lastError,"provider timeout");
  assert.equal(neoRetryDue(second,at+899_999),false);
  assert.equal(neoRetryDue(second,at+900_000),true);
});
