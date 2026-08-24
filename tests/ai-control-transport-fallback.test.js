import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const doc=fs.readFileSync(new URL("../docs/ai-control-transport-fallback.md",import.meta.url),"utf8");

test("dual transport fallback preserves one canonical objective and authority boundary",()=>{
  assert.match(doc,/one canonical objective identity/i);
  assert.match(doc,/same `objectiveId`, `commandId`, `correlationId`, and idempotency key/i);
  assert.match(doc,/does not create a second business objective/i);
  assert.match(doc,/Binding financial actions, lender submissions, external communications, fee changes, term acceptance/i);
  assert.match(doc,/read-back-confirmed receipt/i);
});
