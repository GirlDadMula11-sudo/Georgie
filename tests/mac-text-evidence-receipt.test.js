import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Mac job receipts include bounded Git-blob evidence for text results", () => {
  const source = fs.readFileSync(new URL("../src/tools.js", import.meta.url), "utf8");
  const start = source.indexOf("function summarizeMacJobResult");
  const end = source.indexOf("function compactMacJobStatus", start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /textEvidence/);
  assert.match(implementation, /gitBlobSha1/);
  assert.match(implementation, /result\.truncated===true/);
  assert.match(implementation, /omitted:true/);
});
