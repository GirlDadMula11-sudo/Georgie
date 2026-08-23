import test from "node:test";
import assert from "node:assert/strict";
import { eliteTaskContract, verifyEliteTask } from "../src/elite-task-kernel.js";

test("complex production work receives frontier reasoning and governed authority",()=>{
  const contract=eliteTaskContract("Diagnose the entire CRM, repair the database worker, merge to main, and deploy production");
  assert.ok(contract.domains.includes("technical"));assert.ok(contract.domains.includes("sierra"));
  assert.equal(contract.reasoningTier,"frontier");assert.equal(contract.authority,"governed_approval");
  assert.match(contract.completionRule,/terminal receipt/i);
});

test("personal and business domains stay visible in the same task contract",()=>{
  const contract=eliteTaskContract("Compare current family travel options and prepare a budget without purchasing anything");
  assert.ok(contract.domains.includes("personal"));assert.ok(contract.domains.includes("research"));assert.equal(contract.requiresFreshResearch,true);
});

test("verification fails closed when authoritative evidence or receipts are missing",()=>{
  const contract=eliteTaskContract("Send a lender submission email");
  const failed=verifyEliteTask(contract,{acceptanceCriteria:[{passed:true}],evidence:[{}],receipts:[],authoritative:false});
  assert.equal(failed.verified,false);assert.ok(failed.missing.includes("terminal_action_receipt"));assert.equal(failed.mayLearn,false);
  const passed=verifyEliteTask(contract,{acceptanceCriteria:[{passed:true}],evidence:contract.requiredEvidence.map(type=>({type})),receipts:[{terminal:true}],authoritative:true});
  assert.equal(passed.verified,true);assert.equal(passed.mayLearn,true);
});
