import crypto from "node:crypto";
import express from "express";
import { createGovernedConnector } from "./governed-connector.js";
import { verifyConnectorAccessToken } from "./connector-oauth.js";
import { getMailboxEvidencePacket, listMailboxPacketManifests } from "./mailbox-evidence-bridge.js";
import { getCapabilityManifest } from "./capability-manifest.js";

const SERVER = { name: "georgie-governed-connector-r2", version: "2.4.1" };
const PROTOCOL = "2025-03-26";
const clean = (value, max = 6000) => String(value || "").trim().slice(0, max);

export const GEORGIE_CONNECTOR_TOOLS = Object.freeze([
  {
    name: "georgie_dispatch_command",
    title: "Dispatch a governed Georgie command",
    description: "Use this when Jason asks ChatGPT or Codex to hand a bounded objective to Georgie and retain its status, evidence, and recovery identity.",
    inputSchema: { type: "object", additionalProperties: false, required: ["command", "idempotencyKey"], properties: { command: { type: "string", minLength: 1, maxLength: 6000 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }, objectiveId: { type: "string", maxLength: 160 }, metadata: { type: "object" } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "georgie_forward_approval",
    title: "Forward a governed approval",
    description: "Use this when Jason explicitly approves an existing Georgie plan and both immutable Plan and Approval IDs are available.",
    inputSchema: { type: "object", additionalProperties: false, required: ["planId", "approvalId", "idempotencyKey"], properties: { planId: { type: "string", minLength: 1, maxLength: 160 }, approvalId: { type: "string", minLength: 1, maxLength: 160 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 200 }, objectiveId: { type: "string", maxLength: 160 } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "georgie_get_command",
    title: "Get Georgie command status",
    description: "Use this when the user wants the current status, events, or evidence receipts for a previously dispatched Georgie command.",
    inputSchema: { type: "object", additionalProperties: false, required: ["commandId"], properties: { commandId: { type: "string", minLength: 1, maxLength: 160 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "georgie_capability_manifest",
    title: "Read Georgie's live capability manifest",
    description: "Return Georgie's current read-only capability manifest so runtime identity and connected capability state can be verified directly.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "georgie_mailbox_packet_manifests",
    title: "List mailbox evidence packet manifests",
    description: "List redacted packet manifests for one exact governed objective. This cannot search or export a mailbox.",
    inputSchema: { type: "object", additionalProperties: false, required: ["objectiveId"], properties: { objectiveId: { type: "string", minLength: 1, maxLength: 160 }, mailbox: { type: "string", maxLength: 320 }, limit: { type: "integer", minimum: 1, maximum: 500 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
  {
    name: "georgie_mailbox_evidence_packet",
    title: "Get one mailbox evidence packet",
    description: "Retrieve one redacted evidence packet by exact objective and packet ID. This cannot expose arbitrary mailbox content.",
    inputSchema: { type: "object", additionalProperties: false, required: ["objectiveId", "packetId"], properties: { objectiveId: { type: "string", minLength: 1, maxLength: 160 }, packetId: { type: "string", minLength: 1, maxLength: 200 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  },
]);

export function connectorTokenAuthorized(header, expected = process.env.GEORGIE_CONNECTOR_TOKEN) {
  const token = clean(String(header || "").replace(/^Bearer\s+/i, ""), 500); const secret = clean(expected, 500);
  if (!token || !secret || token.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

const textResult = (structuredContent, message, isError = false) => ({ structuredContent, content: [{ type: "text", text: message }], ...(isError ? { isError: true } : {}) });

export function createPortableMcpHandler({ connector, userId = "primary" } = {}) {
  if (!connector) throw new Error("Portable MCP requires the governed connector");
  return async function handle(message = {}) {
    const id = message.id ?? null; const method = clean(message.method, 100);
    if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: "Dispatch only bounded user-authorized objectives. Reuse objective and idempotency IDs. Consequential actions remain governed inside Georgie; never interpret connector access as blanket execution approval." } };
    if (method === "notifications/initialized") return null;
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: GEORGIE_CONNECTOR_TOOLS } };
    if (method !== "tools/call") return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    const name = clean(message.params?.name, 100); const args = message.params?.arguments || {};
    try {
      if (name === "georgie_dispatch_command") {
        const result = await connector.submit(userId, { ...args, source: "openai" });
        return { jsonrpc: "2.0", id, result: textResult(result, result.duplicate ? "The existing Georgie command was reused; no duplicate was created." : "Georgie durably accepted the governed command and returned its execution lease before deep work.") };
      }
      if (name === "georgie_forward_approval") {
        const result = await connector.submit(userId, { ...args, source: "openai", kind: "approval", command: `Approve plan ${args.planId} under approval ${args.approvalId}` });
        return { jsonrpc: "2.0", id, result: textResult(result, result.duplicate ? "The approval dispatch already exists and was not duplicated." : "The approval was durably accepted and leased for governed execution.") };
      }
      if (name === "georgie_get_command") {
        const command = await connector.status(userId, clean(args.commandId, 160));
        if (!command) return { jsonrpc: "2.0", id, result: textResult({ found: false, commandId: clean(args.commandId, 160) }, "That Georgie command was not found.", true) };
        return { jsonrpc: "2.0", id, result: textResult({ found: true, command }, `Georgie command ${command.id} is ${command.status}.`) };
      }
      if (name === "georgie_capability_manifest") {
        const manifest = getCapabilityManifest();
        return { jsonrpc: "2.0", id, result: textResult({ manifest }, `Georgie live runtime is ${manifest?.sessionRuntime?.unifiedOperatingRuntime || "unknown"}.`) };
      }
      if (name === "georgie_mailbox_packet_manifests") {
        const manifests = await listMailboxPacketManifests(userId, args);
        return { jsonrpc: "2.0", id, result: textResult(manifests, `Returned ${manifests.packets.length} redacted mailbox packet manifest(s).`) };
      }
      if (name === "georgie_mailbox_evidence_packet") {
        const packet = await getMailboxEvidencePacket(userId, args);
        if (!packet) return { jsonrpc: "2.0", id, result: textResult({ found: false, objectiveId: clean(args.objectiveId, 160), packetId: clean(args.packetId, 200) }, "That evidence packet was not found in the specified objective.", true) };
        return { jsonrpc: "2.0", id, result: textResult({ found: true, packet }, "Returned one redacted governed mailbox evidence packet.") };
      }
      return { jsonrpc: "2.0", id, result: textResult({ tool: name }, "Unknown Georgie connector tool.", true) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connector tool failed";
      return { jsonrpc: "2.0", id, result: textResult({ error: message }, message, true) };
    }
  };
}

export function createPortableMcpRouter({ executeCommand, userId = "primary" } = {}) {
  const router = express.Router(); const connector = createGovernedConnector({ executeCommand }); const handle = createPortableMcpHandler({ connector, userId });
  router.use((req, res, next) => connectorTokenAuthorized(req.headers.authorization) || verifyConnectorAccessToken(req.headers.authorization) ? next() : res.status(401).set("WWW-Authenticate", `Bearer resource_metadata="${String(process.env.GEORGIE_PUBLIC_ORIGIN || "https://georgie.onrender.com").replace(/\/$/, "")}/.well-known/oauth-protected-resource/mcp"`).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32001, message: "Georgie connector authentication required" } }));
  router.post("/", async (req, res) => { const result = await handle(req.body || {}); if (!result) return res.status(202).end(); res.set("Cache-Control", "no-store").json(result); });
  router.get("/", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Use MCP Streamable HTTP POST" }));
  return router;
}
