import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("explicit developer.file_read preserves exact allowlisted repo and path", () => {
  assert.deepEqual(
    deterministicToolPlan("developer.file_read repo=/Users/mac/Georgie path=mac-agent/agent.js"),
    [{ tool: "developer.file_read", args: { repo: "/Users/mac/Georgie", path: "mac-agent/agent.js" } }]
  );
});

test("explicit developer.file_read rejects non-allowlisted repo and traversal", () => {
  assert.deepEqual(deterministicToolPlan("developer.file_read repo=/tmp/other path=src/tools.js"), []);
  assert.deepEqual(deterministicToolPlan("developer.file_read repo=/Users/mac/Georgie path=src/../../.env"), []);
});
