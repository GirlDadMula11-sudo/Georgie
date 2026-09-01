import crypto from "node:crypto";
import express from "express";
import { createGovernedConnector } from "./governed-connector.js";
import { connectorAccessClaims } from "./connector-oauth.js";
import { getMailboxEvidencePacket, listMailboxPacketManifests } from "./mailbox-evidence-bridge.js";
import { getCapabilityManifest } from "./capability-manifest.js";
import { AGENT_HANDOFF_CAPABILITIES, handoffConnectorInput, reconcileHandoffStatus } from "./agent-handoff-protocol.js";

const SERVER = { name: "georgie-governed-connector-r2", version: "2.4.3" };
const PROTOCOL = "2025-03-26";
const clean = (value, max = 6000) => String(value || "").trim().slice(0, max);

export const GEORGIE_CONNECTOR_TOOLS = Object.freeze([
  {
    name: "georgie_submit_handoff",
    title: "Submit a versioned objective handoff",
    description: "Commit one bounded, versioned Codex or ChatGPT objective to Georgie's durable executor with explicit capabilities, authority, budgets, expiry, acceptance criteria, and evidence requirements.",
    inputSchema: { type: "object", additionalProperties: false, required: ["objectiveId", "sequenceNumber", "objective"], properties: { objectiveId:{type:"string",minLength:6,maxLength:160},sequenceNumber:{type:"integer",minimum:1},objective:{type:"string",minLength:1,maxLength:6000},scope:{type:"object"},constraints:{type:"array",items:{type:"string"}},requiredCapabilities:{type:"array",items:{type:"string"}},acceptanceCriteria:{type:"array",items:{type:"string"}},evidenceRequirements:{type:"array",items:{type:"string"}},authority:{type:"object"},budget:{type:"object"},issuedAt:{type:"string"},expiresAt:{type:"string"},leaseSeconds:{type:"integer",minimum:30,maximum:1800},idempotencyKey:{type:"string",maxLength:200} } },
    annotations: { readOnlyHint:false,destructiveHint:false,openWorldHint:false,idempotentHint:true }
  },
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
    name:"georgie_get_objective",
    title:"Reconcile a Georgie objective",
    description:"Return the latest version, lease, history, evidence receipts, and verified-versus-executed state for one durable objective.",
    inputSchema:{type:"object",additionalProperties:false,required:["objectiveId"],properties:{objectiveId:{type:"string",minLength:6,maxLength:160}}},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false,idempotentHint:true}
  },
  {
    name:"georgie_revoke_objective",
    title:"Revoke a Georgie objective",
    description:"Fence all nonterminal execution for one exact objective at the next durable checkpoint. This does not reverse already completed external effects.",
    inputSchema:{type:"object",additionalProperties:false,required:["objectiveId"],properties:{objectiveId:{type:"string",minLength:6,maxLength:160},reason:{type:"string",maxLength:1000}}},
    annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false,idempotentHint:true}
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
const COMMAND_TOOLS = new Set(["georgie_submit_handoff","georgie_dispatch_command","georgie_forward_approval","georgie_revoke_objective"]);
const scopeSet = value => new Set(String(value || "").split(/\s+/).filter(Boolean));

export function connectorTokenAuthorized(header, expected = process.env.GEORGIE_CONNECTOR_TOKEN) {
  const token = clean(String(header || "").replace(/^Bearer\s+/i, ""), 500); const secret = clean(expected, 500);
  if (!token || !secret || token.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

const textResult = (structuredContent, message, isError = false) => ({ structuredContent, content: [{ type: "text", text: message }], ...(isError ? { isError: true } : {}) });

export function createPortableMcpHandler({ connector, userId = "primary" } = {}) {
  if (!connector) throw new Error("Portable MCP requires the governed connector");
  return async function handle(message = {}, access = { command: true, status: true }) {
    const id = message.id ?? null; const method = clean(message.method, 100);
    if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: "Dispatch only bounded user-authorized objectives. Reuse objective and idempotency IDs. Consequential actions remain governed inside Georgie; never interpret connector access as blanket execution approval." } };
    if (method === "notifications/initialized") return null;
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: GEORGIE_CONNECTOR_TOOLS.filter(tool => access.command || !COMMAND_TOOLS.has(tool.name)) } };
    if (method !== "tools/call") return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    const name = clean(message.params?.name, 100); const args = message.params?.arguments || {};
    try {
      if (COMMAND_TOOLS.has(name) && !access.command) throw new Error("GEORGIE_COMMAND_SCOPE_REQUIRED");
      if (!COMMAND_TOOLS.has(name) && !access.status) throw new Error("GEORGIE_STATUS_SCOPE_REQUIRED");
      if(name==="georgie_submit_handoff"){
        const result=await connector.submit(userId,handoffConnectorInput(args));
        return{jsonrpc:"2.0",id,result:textResult({...result,handoff:reconcileHandoffStatus({...result,id:result.commandId,metadata:{agent_handoff:args}})},result.duplicate?"The existing handoff version was reused without duplicate execution.":"Georgie durably accepted the versioned objective handoff.")};
      }
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
      if(name==="georgie_get_objective"){
        const objective=await connector.objectiveStatus(userId,clean(args.objectiveId,160));
        if(!objective)return{jsonrpc:"2.0",id,result:textResult({found:false,objectiveId:clean(args.objectiveId,160)},"That Georgie objective was not found.",true)};
        return{jsonrpc:"2.0",id,result:textResult({found:true,objective,reconciliation:reconcileHandoffStatus(objective.current)},`Georgie objective ${objective.objectiveId} is ${objective.current.status}.`)};
      }
      if(name==="georgie_revoke_objective"){
        const result=await connector.revoke(userId,clean(args.objectiveId,160),clean(args.reason,1000)||"Revoked by authorized coordinator");
        return{jsonrpc:"2.0",id,result:textResult(result,result.revoked?"Georgie fenced the objective at its durable execution boundary.":"The objective was already terminal; no execution was changed.")};
      }
      if (name === "georgie_capability_manifest") {
        const manifest = getCapabilityManifest();
        return { jsonrpc: "2.0", id, result: textResult({ manifest,agentHandoffV1:{protocol:"georgie-handoff.v1",capabilities:AGENT_HANDOFF_CAPABILITIES,dynamicNegotiation:false,credentialsTransferred:false} }, `Georgie live runtime is ${manifest?.sessionRuntime?.unifiedOperatingRuntime || "unknown"}.`) };
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
  const router = express.Router(); const connector = createGovernedConnector({ executeCommand }); const handle = createPortableMcpHandler({ connector, userId }); setImmediate(() => connector.resume(userId).catch(error => console.error("[Georgie] connector startup resume failed:", error instanceof Error ? error.message : error))); const resumePendingConnectorWork=()=>connector.resume(userId).catch(error=>console.error("[Georgie] connector recovery supervisor failed:",error instanceof Error?error.message:error)); setImmediate(resumePendingConnectorWork); const connectorRecoveryTimer=setInterval(resumePendingConnectorWork,45000); connectorRecoveryTimer.unref?.();
  router.use((req, res, next) => { const staticAccess=connectorTokenAuthorized(req.headers.authorization),claims=staticAccess?null:connectorAccessClaims(req.headers.authorization);if(!staticAccess&&!claims)return res.status(401).set("WWW-Authenticate", `Bearer resource_metadata="${String(process.env.GEORGIE_PUBLIC_ORIGIN || "https://georgie.onrender.com").replace(/\/$/, "")}/.well-known/oauth-protected-resource/mcp"`).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32001, message: "Georgie connector authentication required" } });const scopes=scopeSet(claims?.scope);req.georgieConnectorAccess={command:staticAccess||scopes.has("georgie:command"),status:staticAccess||scopes.has("georgie:status")};next();});
  router.post("/", async (req, res) => { const result = await handle(req.body || {},req.georgieConnectorAccess); if (!result) return res.status(202).end(); res.set("Cache-Control", "no-store").json(result); });
  router.get("/", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "Use MCP Streamable HTTP POST" }));
  return router;
}
