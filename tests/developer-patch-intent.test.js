import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("hash-bound developer patch marker routes directly", () => {
  const payload = {repo:"/Users/mac/Georgie",patch:"--- a/mac-agent/agent.js\n+++ b/mac-agent/agent.js\n@@ -1 +1 @@\n-old\n+new\n",title:"Bounded repair",summary:"Exact patch"};
  const actions = deterministicToolPlan("DEVELOPER_PATCH_JSON:" + JSON.stringify(payload));
  assert.equal(actions[0].tool, "developer.prepare_patch");
  assert.equal(actions[0].args.repo, payload.repo);
  assert.equal(actions[0].args.patch, payload.patch);
});

test("approved developer patch marker routes to primary Mac", () => {
  const approvalId = "11111111-2222-3333-4444-555555555555";
  assert.deepEqual(
    deterministicToolPlan("DEVELOPER_APPLY_JSON:" + JSON.stringify({approvalId})),
    [{tool:"developer.apply_approved_patch",args:{approvalId,deviceId:"primary-mac"}}]
  );
});

test("developer patch markers reject other repositories", () => {
  assert.deepEqual(deterministicToolPlan("DEVELOPER_PATCH_JSON:" + JSON.stringify({repo:"/tmp/nope",patch:"x"})), []);
});
