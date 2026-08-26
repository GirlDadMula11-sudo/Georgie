import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const agent = await fs.readFile(new URL("../mac-agent/agent.js", import.meta.url), "utf8");
const tools = await fs.readFile(new URL("../src/tools.js", import.meta.url), "utf8");

test("Mac agent exposes hash-bound snapshot reconciliation without destructive git cleanup", () => {
  assert.match(agent, /case "developer\.snapshot_reconcile_restart_from_main"/);
  assert.match(agent, /PRIMARY_MAC_UNRELATED_WORK_PRESENT/);
  assert.match(agent, /PRIMARY_MAC_WORKING_BLOB_MISMATCH/);
  assert.match(agent, /PRIMARY_MAC_SNAPSHOT_VERIFY_FAILED/);
  assert.doesNotMatch(agent, /PRIMARY_MAC_TOOLS_NOT_REMOTE_IDENTICAL/);
  assert.match(agent, /recovery-snapshots/);
  assert.match(agent, /PRIMARY_MAC_PRESERVED_RESTORE_VERIFY_FAILED/);
  assert.match(agent, /PRIMARY_MAC_PRESERVED_RESTORE_SCOPE_FAILED/);
  assert.match(agent, /preservedWorktreeRestored: true/);
  assert.match(agent, /"--ff-only", "origin\/main"/);
  assert.doesNotMatch(agent, /"reset", \["--hard"/);
  assert.doesNotMatch(agent, /"clean", \["-f/);
});

test("server registers only the bounded sensitive-write snapshot action", () => {
  assert.match(tools, /name:"developer\.snapshot_reconcile_restart_from_main"/);
  assert.match(tools, /risk:"sensitive_write"/);
  assert.match(tools, /preservePaths=\["mac-agent\/agent\.js","src\/governed-connector\.js","src\/tools\.js"\]/);
  assert.match(tools, /Exact expected Git blob hashes are required/);
});
