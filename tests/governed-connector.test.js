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

test("typed connector results remain available through the return channel", async () => {
  const connector = harness({ executeCommand: async () => assert.fail("typed command entered prose router") });
  const first = await connector.submit("typed-result-return", mailboxEnvelope({ idempotencyKey: "typed-result-return-1" }));
  const stored = await connector.status("typed-result-return", first.commandId);
  assert.equal(stored.result.route.target_device, "primary-mac");
  assert.equal(stored.result.job.authority, "read_only");
  assert.equal(stored.result.job.id, first.result.job.id);
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

const mailboxEnvelope = (overrides = {}) => ({
  source: "chatgpt",
  objectiveId: "SIERRA-LI-MBX-20260823-001",
  idempotencyKey: "mailbox-route-1",
  command: "Resume mailbox evidence certification; rejected CM-100 receipts remain unrelated.",
  metadata: {
    capability: "primary_mac.mailbox.read_only",
    target_device: "primary-mac",
    operation: "connection_verify_and_backfill",
    authority: "read_only",
    prohibited_routes: ["cm-100", "sierra.continue_diagnostic_investigation"],
    mailboxes: ["mailbox-one@sierramarketinginc.com", "mailbox-two@sierramarketinginc.com"],
    batchLimit: 25
  },
  ...overrides
});

test("mailbox commands match only the primary Mac read-only capability", () => {
  const envelope = validateCommandEnvelope(mailboxEnvelope());
  assert.deepEqual(envelope.routing, {
    objective_id: "SIERRA-LI-MBX-20260823-001",
    capability: "primary_mac.mailbox.read_only",
    target_device: "primary-mac",
    operation: "connection_verify_and_backfill",
    authority: "read_only",
    idempotency_key: "mailbox-route-1",
    prohibited_routes: ["cm-100", "sierra.continue_diagnostic_investigation"]
  });
});

test("MCP-safe nested command envelopes route deterministically", () => {
  const envelope = validateCommandEnvelope({
    source: "openai",
    objectiveId: "SIERRA-LI-MBX-20260823-001",
    idempotencyKey: "nested-mailbox-route",
    command: "Continue the existing mailbox objective.",
    metadata: { command_envelope: {
      objective_id: "SIERRA-LI-MBX-20260823-001",
      capability: "neo_mailbox_evidence_bridge",
      target_device: "primary-mac",
      operation: "connection_verify_and_backfill",
      authority: "read_only",
      idempotency_key: "nested-mailbox-route",
      prohibited_routes: ["cm-100", "stale_continuation", "gmail", "apple_mail"]
    } }
  });
  assert.equal(envelope.routing.capability, "neo_mailbox_evidence_bridge");
  assert.equal(envelope.routing.target_device, "primary-mac");
  assert.equal(envelope.routing.authority, "read_only");
});

test("CM-100 prose cannot capture a typed mailbox objective", async () => {
  let proseCalls = 0;
  const connector = harness({ executeCommand: async () => { proseCalls += 1; return { terminalState: "completed" }; } });
  const result = await connector.submit("typed-mailbox-route", mailboxEnvelope());
  assert.equal(proseCalls, 0);
  assert.equal(result.result.route.capability, "primary_mac.mailbox.read_only");
  assert.equal(result.result.job.deviceId, "primary-mac");
  assert.equal(result.result.job.authority, "read_only");
});

test("duplicate typed commands create one logical execution", async () => {
  const connector = harness({ executeCommand: async () => assert.fail("typed command entered prose router") });
  const first = await connector.submit("typed-mailbox-dedupe", mailboxEnvelope());
  const second = await connector.submit("typed-mailbox-dedupe", mailboxEnvelope());
  assert.equal(second.duplicate, true);
  assert.equal(second.commandId, first.commandId);
  assert.equal(second.objectiveId, first.objectiveId);
});

test("unsupported capabilities and mismatched authority fail explicitly", () => {
  assert.throws(() => validateCommandEnvelope(mailboxEnvelope({ metadata: { ...mailboxEnvelope().metadata, capability: "sierra.deal" } })), /UNSUPPORTED_CAPABILITY/);
  assert.throws(() => validateCommandEnvelope(mailboxEnvelope({ metadata: { ...mailboxEnvelope().metadata, authority: "write" } })), /CAPABILITY_AUTHORITY_MISMATCH/);
});

test("primary Mac maintenance is exact, bounded, and cannot enter mailbox routes", async () => {
  const input = {
    source: "chatgpt",
    objectiveId: "SIERRA-LI-MBX-20260823-001",
    idempotencyKey: `mac-self-update-${Date.now()}`,
    command: "Update and restart the local Georgie agent, then resume the existing objective.",
    metadata: {
      capability: "primary_mac.agent.maintenance",
      target_device: "primary-mac",
      operation: "update_restart_from_main",
      authority: "local_admin",
      prohibited_routes: ["cm-100", "stale_continuation", "gmail", "apple_mail", "mailbox.read", "mailbox.write"],
      repo: "/Users/mac/Georgie",
      expected_agent_version: "2.2.5"
    }
  };
  const envelope = validateCommandEnvelope(input);
  assert.equal(envelope.routing.capability, "primary_mac.agent.maintenance");
  assert.equal(envelope.routing.authority, "local_admin");
  const connector = harness({ executeCommand: async () => assert.fail("maintenance command entered prose router") });
  const first = await connector.submit("primary", input);
  const duplicate = await connector.submit("primary", input);
  assert.deepEqual(first.result.jobs.map((job) => job.action), ["developer.update_restart_from_main"]);
  assert.equal(first.result.jobs.every((job) => job.deviceId === "primary-mac"), true);
  assert.equal(duplicate.duplicate, true);
  assert.throws(() => validateCommandEnvelope({ ...input, metadata: { ...input.metadata, operation: "connection_verify_and_backfill" } }), /UNSUPPORTED_OPERATION/);
  assert.throws(() => validateCommandEnvelope({ ...input, metadata: { ...input.metadata, authority: "read_only" } }), /CAPABILITY_AUTHORITY_MISMATCH/);
  assert.throws(() => validateCommandEnvelope({ ...input, metadata: { ...input.metadata, prohibited_routes: ["mailbox.read", "cm-100", "arbitrary"] } }), /UNKNOWN_PROHIBITED_ROUTE/);
});

test("interruption resumes the same objective and step", async () => {
  let fail = true;
  const connector = harness({ executeCommand: async () => { if (fail) throw new Error("interrupted"); return { terminalState: "completed" }; } });
  const input = { source: "chatgpt", objectiveId: "objective-resume", idempotencyKey: "resume-same-step", command: "continue" };
  const first = await connector.submit("objective-isolation", input);
  fail = false;
  const resumed = await connector.resume("objective-isolation");
  assert.equal(resumed[0].commandId, first.commandId);
  assert.equal(resumed[0].objectiveId, "objective-resume");
});


test("typed NEO contract inspection is diagnostic-only and cannot dispatch mailbox backfill", async()=>{
  const input=mailboxEnvelope({idempotencyKey:"neo-static-contract-1",metadata:{...mailboxEnvelope().metadata,capability:"neo_mailbox_evidence_bridge",operation:"static_contract_inspection",prohibited_routes:["cm-100","stale_continuation","gmail","apple_mail"]}});
  const envelope=validateCommandEnvelope(input);
  assert.equal(envelope.routing.operation,"static_contract_inspection");
  const connector=harness({executeCommand:async()=>assert.fail("typed inspection entered prose router")});
  const result=await connector.submit("neo-static-contract",input);
  assert.equal(result.result.job.action,"mailbox.neo_static_contract_inspect");
  assert.equal(result.result.job.authority,"read_only");
  assert.notEqual(result.result.job.action,"mailbox.read_only_backfill");
});
