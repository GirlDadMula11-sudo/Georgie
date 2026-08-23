import test from "node:test";
import assert from "node:assert/strict";
import { createGovernedConnector, normalizeConnectorState, validateCommandEnvelope } from "../src/governed-connector.js";

function harness(options = {}) {
  let state = { schema: "georgie.governed-connector.v1", version: 1, commands: [], events: [], receipts: [], updatedAt: null };
  return createGovernedConnector({ ...options, readState: async () => structuredClone(state), writeState: async (_userId, next) => { state = structuredClone(next); }, retainObjective: async () => ({ id: "node-1" }), transitionObjective: async () => ({ id: "node-1" }) });
}

test("connector requires idempotency and binds approval IDs", () => {
  assert.throws(() => validateCommandEnvelope({ command: "continue" }), /idempotency/i);
  assert.throws(() => validateCommandEnvelope({ kind: "approval", command: "approve", idempotencyKey: "one" }), /planId and approvalId/i);
  const value = validateCommandEnvelope({ kind: "approval", command: "approve", idempotencyKey: "one", planId: "plan-1", approvalId: "approval-1" });
  assert.equal(value.kind, "approval"); assert.equal(value.planId, "plan-1"); assert.equal(value.approvalId, "approval-1");
});

test("connector dispatches once and returns objective and evidence receipts", async () => {
  let calls = 0; const statuses = [];
  const connector = harness({ executeCommand: async ({ connector: context }) => { calls += 1; return { text: "Verified", terminalState: "completed", context }; }, emitStatus: async (event) => statuses.push(event.status) });
  const input = { source: "chatgpt", idempotencyKey: `test-${Date.now()}`, objectiveId: "shared-objective-1", command: "Inspect the Sierra evidence ledger" };
  const first = await connector.submit("connector-test", input); const second = await connector.submit("connector-test", input);
  assert.equal(first.status, "completed"); assert.equal(first.objectiveId, "shared-objective-1"); assert.match(first.receipt.receiptId, /^rcpt_/);
  assert.equal(second.duplicate, true); assert.equal(second.commandId, first.commandId); assert.equal(calls, 1);
  assert.deepEqual(statuses, ["running", "completed"]);
  const stored = await connector.status("connector-test", first.commandId); assert.equal(stored.status, "completed"); assert.ok(stored.receipts.length >= 3);
});

test("failed work remains resumable under the same command ID", async () => {
  let fail = true; const connector = harness({ executeCommand: async () => { if (fail) throw new Error("temporary outage"); return { terminalState: "completed" }; } });
  const input = { source: "chatgpt", idempotencyKey: `resume-${Date.now()}`, command: "Resume the bounded investigation" };
  const first = await connector.submit("connector-resume-test", input); assert.equal(first.status, "failed");
  fail = false; const resumed = await connector.resume("connector-resume-test"); assert.equal(resumed.length, 1); assert.equal(resumed[0].commandId, first.commandId); assert.equal(resumed[0].status, "completed");
});

test("legacy or partial durable state normalizes before command processing", async () => {
  assert.deepEqual(normalizeConnectorState({ schema: "legacy", commands: null, unrelated: true }), {
    schema: "georgie.governed-connector.v1",
    version: 1,
    commands: [],
    events: [],
    receipts: [],
    updatedAt: null,
    unrelated: true
  });
});
