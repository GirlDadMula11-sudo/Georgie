import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("cloud-state pressure installer includes queued-request circuit fence",()=>{
  const source=fs.readFileSync("scripts/install-cloud-state-pressure.mjs","utf8");
  assert.match(source,/await acquire\(\);try\{if\(Date\.now\(\)<providerUnavailableUntil\)/);
  assert.match(source,/queuedRequestCircuitFence:true/);
});
