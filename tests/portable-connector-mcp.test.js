import test from "node:test";
import assert from "node:assert/strict";
import { connectorTokenAuthorized, createPortableMcpHandler, GEORGIE_CONNECTOR_TOOLS } from "../src/portable-connector-mcp.js";

test("portable connector exposes six focused accurately annotated tools", () => {
  assert.deepEqual(GEORGIE_CONNECTOR_TOOLS.map((tool) => tool.name), ["georgie_dispatch_command", "georgie_forward_approval", "georgie_get_command", "georgie_capability_manifest", "georgie_mailbox_packet_manifests", "georgie_mailbox_evidence_packet"]);
  assert.equal(GEORGIE_CONNECTOR_TOOLS[0].annotations.idempotentHint, true);
  assert.equal(GEORGIE_CONNECTOR_TOOLS[2].annotations.readOnlyHint, true);
  assert.equal(GEORGIE_CONNECTOR_TOOLS[3].annotations.readOnlyHint, true);
});

test("portable connector authentication fails closed", () => {
  assert.equal(connectorTokenAuthorized("Bearer secret", "secret"), true);
  assert.equal(connectorTokenAuthorized("Bearer wrong", "secret"), false);
  assert.equal(connectorTokenAuthorized("", "secret"), false);
});

test("MCP initializes, lists tools, dispatches, forwards approvals, and reads status", async () => {
  const calls = []; const connector = { submit: async (_userId, input) => { calls.push(input); return { commandId: `command-${calls.length}`, objectiveId: input.objectiveId || "objective-1", status: "completed" }; }, status: async (_userId, id) => ({ id, status: "completed", receipts: [{ receiptId: "receipt-1" }] }) };
  const handle = createPortableMcpHandler({ connector });
  const initialized = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }); assert.match(initialized.result.serverInfo.name, /^georgie-governed-connector(?:-r[0-9]+)?$/);
  const listed = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }); assert.equal(listed.result.tools.length, 6);
  const dispatched = await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "georgie_dispatch_command", arguments: { command: "Inspect Sierra", idempotencyKey: "one" } } }); assert.equal(dispatched.result.structuredContent.status, "completed");
  const approved = await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "georgie_forward_approval", arguments: { planId: "p1", approvalId: "a1", idempotencyKey: "two" } } }); assert.equal(approved.result.structuredContent.status, "completed"); assert.equal(calls[1].kind, "approval");
  const status = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "georgie_get_command", arguments: { commandId: "command-1" } } }); assert.equal(status.result.structuredContent.command.receipts[0].receiptId, "receipt-1");
});
