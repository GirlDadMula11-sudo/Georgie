import test from "node:test";
import assert from "node:assert/strict";
import { humanizeResponseText } from "../src/human-response.js";

test("registry receipt failures never reach Jason as raw JSON",()=>{
  const raw=JSON.stringify({ok:false,error:{code:"NO_REGISTRY_INVOCATION_RECEIPT",message:"No governed plan-registry mutation result is present in current execution evidence."},newPlanId:null,newApprovalId:null,version:null,executedRepairPlan:false},null,2);
  const result=humanizeResponseText(raw);
  assert.match(result,/couldn’t update the repair plan/i);
  assert.match(result,/no replacement plan or approval was created/i);
  assert.match(result,/do not need to approve anything yet/i);
  assert.doesNotMatch(result,/NO_REGISTRY_INVOCATION_RECEIPT|newPlanId|executedRepairPlan|^\s*\{/m);
});

test("fenced error JSON is translated while ordinary prose is preserved",()=>{
  const translated=humanizeResponseText('```json\n{"ok":false,"error":{"code":"FAILED","message":"The provider timed out."}}\n```');
  assert.match(translated,/couldn’t complete that action/i);
  assert.match(translated,/provider timed out/i);
  const prose="I checked the system and nothing changed.";
  assert.equal(humanizeResponseText(prose),prose);
});
