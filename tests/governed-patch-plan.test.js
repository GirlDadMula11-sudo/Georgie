import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("governed patch marker embeds exact patch and hash in a versioned plan", () => {
  const patch = "--- a/mac-agent/agent.js\n+++ b/mac-agent/agent.js\n";
  const patchHash = "a".repeat(64);
  const actions = deterministicToolPlan("DEVELOPER_GOVERNED_PATCH_JSON:" + JSON.stringify({repo:"/Users/mac/Georgie",patch,patchHash}));
  assert.equal(actions[0].tool, "approvals.prepare_plan");
  assert.equal(actions[0].args.execution.tool, "developer.apply_governed_patch");
  assert.deepEqual(actions[0].args.execution.args, {repo:"/Users/mac/Georgie",patch,patchHash,deviceId:"primary-mac"});
});

test("governed patch marker rejects malformed hashes", () => {
  assert.deepEqual(deterministicToolPlan("DEVELOPER_GOVERNED_PATCH_JSON:" + JSON.stringify({repo:"/Users/mac/Georgie",patch:"x",patchHash:"bad"})), []);
});
