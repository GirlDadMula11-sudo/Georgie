import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import(`../scripts/install-governed-connector-singleflight.mjs?completion-fence=${Date.now()}`);

test("all-failed planned actions cannot terminalize as completed", () => {
  const source=fs.readFileSync(new URL("../src/governed-connector.js",import.meta.url),"utf8");
  assert.match(source,/failedActions=Array\.isArray\(result\?\.actions\)/);
  assert.match(source,/result\.actions\.every\(action=>action\?\.ok===false\)/);
  assert.match(source,/terminalState==="blocked"\|\|result\?\.outcome\?\.terminalState==="blocked"\|\|failedActions/);
});
