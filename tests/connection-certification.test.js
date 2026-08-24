import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const doc=fs.readFileSync(new URL("../docs/connection-certification.md",import.meta.url),"utf8");
test("connection certification requires exactly-once execution and identity-preserving fallback",()=>{
  assert.match(doc,/Duplicate dispatch produces one logical execution/);
  assert.match(doc,/matching objective and command IDs/);
  assert.match(doc,/same identity/);
  assert.match(doc,/No transport changes approval boundaries/);
  assert.match(doc,/georgie-master-closer-v1/);
});
