import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("verified Mac outcomes cannot add an empty CSS class",async()=>{
  const source=await fs.readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(source,/\["verified","partial"\]\.includes\(rawTerminalState\)/);
  assert.doesNotMatch(source,/classList\.add\(terminalState,terminalState===/);
  assert.match(source,/if\(terminalState==="completed"\)panel\.classList\.add\("complete"\)/);
});
