import test from "node:test";
import assert from "node:assert/strict";
import { resolveReconciliationMode } from "../src/reconciliation-workers.js";

test("an approved bounded request can override shadow observation",()=>{
  assert.equal(resolveReconciliationMode("shadow","bounded"),"bounded");
});

test("the automation kill switch always overrides approved execution",()=>{
  assert.equal(resolveReconciliationMode("paused","bounded"),"paused");
});

test("ordinary checks cannot silently promote shadow mode",()=>{
  assert.equal(resolveReconciliationMode("shadow",null),"shadow");
});
