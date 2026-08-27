import test from "node:test";
import assert from "node:assert/strict";
import { reliabilityFastResponse } from "../src/reliability-fast-paths.js";
import { modelCreditBlock } from "../src/georgie.js";

test("ordinary organization guidance remains useful without model credits",()=>{
  const response=reliabilityFastResponse("Give me three practical ways to make a busy workday more organized.");
  assert.equal(response?.model,"deterministic-practical-guidance");
  assert.equal(response?.completed,true);
  assert.equal(response?.terminalState,"verified");
  assert.match(response.text,/three outcomes/i);
  assert.match(response.text,/scheduled blocks/i);
  assert.match(response.text,/ten-minute reset/i);
});

test("billing exhaustion is classified separately from recoverable provider failures",()=>{
  assert.equal(modelCreditBlock("You have no credits remaining. Add credits to continue using the API"),true);
  assert.equal(modelCreditBlock("insufficient_quota"),true);
  assert.equal(modelCreditBlock("The operation was aborted due to timeout"),false);
  assert.equal(modelCreditBlock("connection reset"),false);
});
