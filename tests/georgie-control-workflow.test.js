import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflow=fs.readFileSync(new URL("../.github/workflows/georgie-control-inbound.yml",import.meta.url),"utf8");

test("Georgie control workflow is dedicated-branch push only with manual recovery",()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/push:/);
  assert.match(workflow,/branches:\s*\n\s*- georgie-control/);
  assert.match(workflow,/\.georgie\/control-signal\.json/);
  assert.doesNotMatch(workflow,/issue_comment:/);
  assert.doesNotMatch(workflow,/schedule:/);
  assert.match(workflow,/georgie-master-closer-v1/);
  assert.match(workflow,/cmd_master_closer_fallback_probe_20260823/);
  assert.match(workflow,/master-closer-controlplane-fallback-probe-20260823-v1/);
});
