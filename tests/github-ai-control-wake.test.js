import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow=fs.readFileSync(new URL("../.github/workflows/georgie-ai-control-wake.yml",import.meta.url),"utf8");

test("AI-control wake only dispatches the already-governed relay workflows",()=>{
  assert.match(workflow,/actions:\s*write/);
  assert.match(workflow,/contents:\s*read/);
  assert.doesNotMatch(workflow,/issues:\s*write/);
  assert.doesNotMatch(workflow,/id-token:\s*write/);
  assert.match(workflow,/georgie-receipt-relay\.yml/);
  assert.match(workflow,/georgie-control-inbound\.yml/);
  assert.match(workflow,/actions\/workflows\/\$\{workflow\}\/dispatches/);
  assert.match(workflow,/-f ref=main/);
});

test("AI-control wake is bounded to main pushes that change control-plane transport surfaces",()=>{
  assert.match(workflow,/push:/);
  assert.match(workflow,/branches:\s*\n\s*- main/);
  assert.match(workflow,/paths:/);
  assert.match(workflow,/github-receipt-relay\.js/);
  assert.match(workflow,/github-control-inbound\.js/);
  assert.doesNotMatch(workflow,/georgie\.onrender\.com/);
  assert.doesNotMatch(workflow,/supabase|vercel|provider/i);
});
