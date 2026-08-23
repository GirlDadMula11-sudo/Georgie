import crypto from "node:crypto";
import express from "express";
import { createGovernedConnector } from "./governed-connector.js";

const SERVER = { name: "georgie-governed-connector", version: "1.0.0" };
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
        return { jsonrpc: "2.0", id, result: textResult(result, result.duplicate ? "The existing Georgie command was reused; no duplicate was created." : "Georgie accepted and processed the governed command.") };
      }
      if (name === "georgie_forward_approval") {
        const result = await connector.submit(userId, { ...args, source: "openai", kind: "approval", command: `Approve plan ${args.planId} under approval ${args.approvalId}` });
        return { jsonrpc: "2.0", id, result: textResult(result, result.duplicate ? "The approval dispatch already exists and was not duplicated." : "The approval was forwarded through Georgie's governed execution path.") };
      }
      if (name === "georgie_get_command") {
        const command = await connector.status(userId, clean(args.commandId, 160));
        if (!command) return { jsonrpc: "2.0", id, result: textResult({ found: false, commandId: clean(args.commandId, 160) }, "That Georgie command was not found.", true) };
        return { jsonrpc: "2.0", id, result: textResult({ found: true, command }, `Georgie command ${command.id} is ${command.status}.`) };
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
  router.use((req, res, next) => connectorTokenAuthorized(req.headers.authorization) ? next() : res.status(401).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32001, message: "Georgie connector authentication required" } }));
  router.post("/", async (req, res) => { const result = await handle(req.body || {}); if (!result) return res.status(202).end(); res.set("Cache-Control", "no-store").json(result); });
  router.get("/", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Use MCP Streamable HTTP POST" }));
  return router;
}
