import crypto from "node:crypto";
import express from "express";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { upsertOperatingNode, transitionOperatingNode } from "./operating-graph.js";

const NS = "governed_external_connector";
const SCHEMA = "georgie.governed-connector.v1";
const locks = new Map();
const now = () => new Date().toISOString();
const clean = (value, max = 6000) => String(value || "").trim().slice(0, max);
const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function baseState() { return { schema: SCHEMA, version: 1, commands: [], events: [], receipts: [], updatedAt: null }; }\nexport function normalizeConnectorState(value) {\n  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};\n  return { ...baseState(), ...input, schema: SCHEMA, version: 1, commands: Array.isArray(input.commands) ? input.commands : [], events: Array.isArray(input.events) ? input.events : [], receipts: Array.isArray(input.receipts) ? input.receipts : [] };\n}
function commandId(userId, source, key) { return `cmd_${digest(`${userId}:${source}:${key}`).slice(0, 32)}`; }
function objectiveId(userId, source, supplied, command) { return supplied ? clean(supplied, 160) : `obj_${digest(`${userId}:${source}:${command}`).slice(0, 32)}`; }
function receiptFor(command, status, payload = {}) {
  const createdAt = now();
  const body = { commandId: command.id, objectiveId: command.objectiveId, status, createdAt, payload };
  return { ...body, receiptId: `rcpt_${digest(JSON.stringify(body)).slice(0, 32)}` };
}
async function exclusive(userId, work) {
  const key = String(userId); const prior = locks.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(work); locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}

export function validateCommandEnvelope(input = {}) {
  const source = clean(input.source || "chatgpt", 80).toLowerCase();
  const idempotencyKey = clean(input.idempotencyKey, 200);
  const command = clean(input.command);
  const kind = input.kind === "approval" ? "approval" : "command";
  if (!/^[a-z0-9._-]{2,80}$/.test(source)) throw new Error("A valid connector source is required");
  if (!idempotencyKey) throw new Error("An idempotency key is required");
  if (!command) throw new Error("A command is required");
  if (kind === "approval" && (!clean(input.planId, 160) || !clean(input.approvalId, 160))) throw new Error("Approval forwarding requires both planId and approvalId");
  return { source, idempotencyKey, command, kind, objectiveId: clean(input.objectiveId, 160) || null, planId: clean(input.planId, 160) || null, approvalId: clean(input.approvalId, 160) || null, metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {} };
}

export function createGovernedConnector({ executeCommand, emitStatus = async () => {}, readState, writeState, retainObjective, transitionObjective } = {}) {
  if (typeof executeCommand !== "function") throw new Error("Connector requires an executeCommand function");
  const readStore = readState || ((userId) => readCloudState(String(userId), NS, baseState()));
  const writeStore = writeState || ((userId, state) => writeCloudState(String(userId), NS, state));
  const retain = retainObjective || ((userId, input) => upsertOperatingNode(userId, input));
  const transition = transitionObjective || ((userId, id, input) => transitionOperatingNode(userId, id, input));
  async function read(userId) { return structuredClone(normalizeConnectorState(await readStore(userId))); }
  async function persist(userId, state) { state.updatedAt = now(); await writeStore(userId, state); return state; }
  async function record(userId, command, status, payload = {}) {
    return exclusive(userId, async () => {
      const state = await read(userId); const item = state.commands.find((row) => row.id === command.id);
      if (item) { item.status = status; item.updatedAt = now(); if (status === "completed") item.completedAt = item.updatedAt; if (status === "failed") item.error = clean(payload.error, 1000); }
      const event = { id: crypto.randomUUID(), commandId: command.id, objectiveId: command.objectiveId, status, createdAt: now() };
      const receipt = receiptFor(command, status, payload);
      state.events.push(event); state.receipts.push(receipt); await persist(userId, state);
      await emitStatus({ ...event, receipt }).catch(() => {});
      return receipt;
    });
  }
  async function run(userId, command) {
    await record(userId, command, "running");
    await transition(userId, command.operatingNodeId, { status: "active", attempted: true, nextAction: "Execute, verify, and return durable evidence." }).catch(() => {});
    try {
      const result = await executeCommand({ userId, sessionId: `connector:${command.source}`, input: command.command, connector: { commandId: command.id, objectiveId: command.objectiveId, planId: command.planId, approvalId: command.approvalId } });
      const evidence = { responseHash: digest(JSON.stringify(result || {})), terminalState: clean(result?.outcome?.terminalState || result?.terminalState || "completed", 80) };
      const receipt = await record(userId, command, "completed", evidence);
      await transition(userId, command.operatingNodeId, { status: "verified", verification: `Connector completion receipt ${receipt.receiptId}` }).catch(() => {});
      return { commandId: command.id, objectiveId: command.objectiveId, status: "completed", result, receipt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const receipt = await record(userId, command, "failed", { error: message });
      await transition(userId, command.operatingNodeId, { status: "recovering", recovery: "Resume this same command ID after the temporary blocker is resolved; do not create a duplicate.", nextAction: message }).catch(() => {});
      return { commandId: command.id, objectiveId: command.objectiveId, status: "failed", error: message, receipt };
    }
  }
  async function submit(userId = "primary", input = {}) {
    const envelope = validateCommandEnvelope(input); let command; let duplicate = false;
    await exclusive(userId, async () => {
      const state = await read(userId); const id = commandId(userId, envelope.source, envelope.idempotencyKey); const existing = state.commands.find((row) => row.id === id);
      if (existing) { command = existing; duplicate = true; return; }
      const objective = objectiveId(userId, envelope.source, envelope.objectiveId, envelope.command);
      const node = await retain(userId, { stableKey: `connector:${objective}`, kind: envelope.kind === "approval" ? "execution" : "objective", title: envelope.command.slice(0, 240), domain: "general", status: "planned", nextAction: "Dispatch through the governed connector and preserve completion evidence.", approvalId: envelope.approvalId });
      command = { id, objectiveId: objective, operatingNodeId: node.id, ...envelope, status: "accepted", attempts: 0, createdAt: now(), updatedAt: now() };
      state.commands.push(command); state.events.push({ id: crypto.randomUUID(), commandId: id, objectiveId: objective, status: "accepted", createdAt: now() }); state.receipts.push(receiptFor(command, "accepted")); await persist(userId, state);
    });
    if (duplicate) return { commandId: command.id, objectiveId: command.objectiveId, status: command.status, duplicate: true };
    return run(userId, command);
  }
  async function status(userId = "primary", id) { const state = await read(userId); const command = state.commands.find((row) => row.id === id); return command ? { ...command, events: state.events.filter((row) => row.commandId === id), receipts: state.receipts.filter((row) => row.commandId === id) } : null; }
  async function resume(userId = "primary") { const state = await read(userId); const pending = state.commands.filter((row) => ["accepted", "running", "failed"].includes(row.status)); const results = []; for (const command of pending) results.push(await run(userId, command)); return results; }
  return { submit, status, resume };
}

function authorized(req) {
  const expected = clean(process.env.GEORGIE_CONNECTOR_TOKEN, 500); const supplied = clean(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), 500);
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function createGovernedConnectorRouter({ executeCommand, emitStatus } = {}) {
  const router = express.Router(); const connector = createGovernedConnector({ executeCommand, emitStatus });
  router.use((req, res, next) => authorized(req) ? next() : res.status(401).json({ ok: false, error: "Governed connector authentication required" }));
  router.post("/commands", async (req, res) => { try { const result = await connector.submit(req.body?.userId || "primary", req.body || {}); res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Connector command rejected" }); } });
  router.post("/approvals", async (req, res) => { try { const body = { ...(req.body || {}), kind: "approval", command: req.body?.command || `Approve plan ${req.body?.planId} under approval ${req.body?.approvalId}` }; const result = await connector.submit(body.userId || "primary", body); res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Approval forwarding rejected" }); } });
  router.get("/commands/:id", async (req, res) => { const result = await connector.status(req.query?.userId || "primary", req.params.id); res.status(result ? 200 : 404).json(result ? { ok: true, command: result } : { ok: false, error: "Command not found" }); });
  return router;
}
