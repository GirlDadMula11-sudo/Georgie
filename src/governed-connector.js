import crypto from "node:crypto";
import express from "express";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { upsertOperatingNode, transitionOperatingNode } from "./operating-graph.js";
import { enqueueMacJob, listMacJobs, resumeFailedMacJob } from "./mac/queue.js";
import { getMacDeviceStatus } from "./mac/router.js";
import { listMailboxPacketManifests } from "./mailbox-evidence-bridge.js";

const NS = "governed_external_connector";
const SCHEMA = "georgie.governed-connector.v1";
const locks = new Map();
const now = () => new Date().toISOString();
const clean = (value, max = 6000) => String(value || "").trim().slice(0, max);
const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const CAPABILITIES = Object.freeze({
  "primary_mac.mailbox.read_only": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["connection_verify_and_backfill"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation"])
  }),
  "neo_mailbox_evidence_bridge": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["connection_verify_and_backfill"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation"])
  }),
  "primary_mac.agent.maintenance": Object.freeze({
    targetDevice: "primary-mac",
    authority: "local_admin",
    operations: new Set(["update_restart_from_main"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "mailbox.read", "mailbox.write"])
  })
});

function baseState() { return { schema: SCHEMA, version: 1, commands: [], events: [], receipts: [], updatedAt: null }; }
export function normalizeConnectorState(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { ...baseState(), ...input, schema: SCHEMA, version: 1, commands: Array.isArray(input.commands) ? input.commands : [], events: Array.isArray(input.events) ? input.events : [], receipts: Array.isArray(input.receipts) ? input.receipts : [] };
}
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
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const nested = metadata.command_envelope && typeof metadata.command_envelope === "object" ? metadata.command_envelope : {};
  const objectiveIdValue = clean(input.objective_id || input.objectiveId || nested.objective_id || nested.objectiveId, 160) || null;
  const capability = clean(input.capability || metadata.capability || metadata.requiredCapability || nested.capability, 160).toLowerCase();
  const targetDevice = clean(input.target_device || input.targetDevice || metadata.target_device || metadata.targetDevice || metadata.deviceId || nested.target_device || nested.targetDevice, 160);
  const operation = clean(input.operation || metadata.operation || nested.operation, 160).toLowerCase();
  const authority = clean(input.authority || metadata.authority || metadata.mode || nested.authority, 80).toLowerCase();
  const prohibitedRoutes = [...new Set((input.prohibited_routes || metadata.prohibited_routes || metadata.prohibitedRoutes || nested.prohibited_routes || nested.prohibitedRoutes || []).map((value) => clean(value, 160).toLowerCase()).filter(Boolean))];
  const typed = Boolean(capability || targetDevice || operation || authority || prohibitedRoutes.length);
  if (typed && !objectiveIdValue) throw new Error("Typed command envelope requires objective_id");
  if (typed && (!capability || !targetDevice || !operation || !authority)) throw new Error("Typed command envelope requires capability, target_device, operation, and authority");
  if (typed) {
    const contract = CAPABILITIES[capability];
    if (!contract) throw new Error(`UNSUPPORTED_CAPABILITY: ${capability}`);
    if (targetDevice !== contract.targetDevice) throw new Error(`CAPABILITY_TARGET_MISMATCH: ${capability} requires ${contract.targetDevice}`);
    if (authority !== contract.authority) throw new Error(`CAPABILITY_AUTHORITY_MISMATCH: ${capability} requires ${contract.authority}`);
    if (!contract.operations.has(operation)) throw new Error(`UNSUPPORTED_OPERATION: ${capability}/${operation}`);
    for (const route of prohibitedRoutes) if (!contract.prohibitedRoutes.has(route)) throw new Error(`UNKNOWN_PROHIBITED_ROUTE: ${route}`);
  }
  return { source, idempotencyKey, command, kind, objectiveId: objectiveIdValue, planId: clean(input.planId, 160) || null, approvalId: clean(input.approvalId, 160) || null, metadata, routing: typed ? { objective_id: objectiveIdValue, capability, target_device: targetDevice, operation, authority, idempotency_key: idempotencyKey, prohibited_routes: prohibitedRoutes } : null };
}

async function executeTypedCapability({ userId, command }) {
  const route = command.routing;
  if (route.capability === "primary_mac.agent.maintenance") {
    const repo = clean(command.metadata?.repo || "/Users/mac/Georgie", 300);
    if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
    const bootstrapPatch = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -13,1 +13,1 @@",
      "-    \"benchmark\": \"node scripts/run-intelligence-benchmark.mjs\",",
      "+    \"benchmark\": \"git restore package.json && git fetch origin main && git merge --ff-only origin/main && ./mac-agent/install.sh\","
    ].join("\n") + "\n";
    const specs = [
      ["developer.apply_patch", { repo, patch: bootstrapPatch, patchHash: digest(bootstrapPatch) }, "Install the one-use Georgie self-update bootstrap"],
      ["developer.run_checks", { repo, script: "benchmark" }, "Run the one-use bootstrap, restore package.json, fast-forward main, and restart Georgie"]
    ];
    const jobs = [];
    for (let index = 0; index < specs.length; index += 1) {
      const [action, args, reason] = specs[index];
      jobs.push(await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk: "sensitive_write", reason, idempotencyKey: `connector:${command.id}:${route.operation}:developer-bootstrap:${index}`, maxAttempts: 1 }));
    }
    return { terminalState: "in_progress", completed: false, route, jobs: jobs.map((job) => ({ id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, dispatchReceipt: job.dispatchReceipt })), expectedAgentVersion: clean(command.metadata?.expected_agent_version, 50) || null };
  }
  if (!["primary_mac.mailbox.read_only", "neo_mailbox_evidence_bridge"].includes(route.capability)) throw new Error(`UNSUPPORTED_CAPABILITY: ${route.capability}`);
  const existingJobId = clean(command.metadata?.existing_job_id || command.metadata?.existingJobId, 200);
  let job;
  if (existingJobId) {
    job = (await listMacJobs(userId, 500)).find((item) => item.id === existingJobId);
    if (!job) throw new Error(`MAC_JOB_NOT_FOUND: ${existingJobId}`);
    if (job.deviceId !== route.target_device || job.action !== "mailbox.read_only_backfill" || job.risk !== "read" || job.args?.authority !== "read_only") throw new Error("MAC_JOB_RESUME_SCOPE_REJECTED");
    if (String(job.args?.objectiveId || "") !== route.objective_id) throw new Error("MAC_JOB_OBJECTIVE_MISMATCH");
    if (["failed", "dead_letter", "completed"].includes(job.status)) job = await resumeFailedMacJob(route.target_device, existingJobId, { objectiveId: route.objective_id, expectedAction: "mailbox.read_only_backfill" });
  } else {
    job = await enqueueMacJob({
      userId,
      deviceId: route.target_device,
      action: "mailbox.read_only_backfill",
      args: { objectiveId: route.objective_id, operation: route.operation, authority: route.authority, checkpoint: command.metadata?.checkpoint || "connection_verification", mailboxes: command.metadata?.mailboxes || [], batchLimit: Math.min(25, Math.max(1, Number(command.metadata?.batchLimit || 25))) },
      risk: "read",
      reason: "Typed governed mailbox backfill",
      idempotencyKey: `connector:${command.id}:${route.operation}`
    });
  }
  return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, claimedByDeviceId: job.dispatchReceipt?.deviceId || null, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };
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
      if (item) { item.status = status; item.updatedAt = now(); if (status === "completed") item.completedAt = item.updatedAt; if (status === "failed") item.error = clean(payload.error, 1000); if (payload.resultSummary) item.result = payload.resultSummary; }
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
      const result = command.routing
        ? await executeTypedCapability({ userId, command })
        : await executeCommand({ userId, sessionId: `connector:${command.source}:objective:${command.objectiveId}`, input: command.command, connector: { commandId: command.id, objectiveId: command.objectiveId, planId: command.planId, approvalId: command.approvalId } });
      const resultSummary = command.routing ? { terminalState: result?.terminalState || null, completed: result?.completed === true, route: result?.route || null, job: result?.job || null, jobs: result?.jobs || null, expectedAgentVersion: result?.expectedAgentVersion || null } : null;
      const evidence = { responseHash: digest(JSON.stringify(result || {})), terminalState: clean(result?.outcome?.terminalState || result?.terminalState || "completed", 80), ...(resultSummary ? { resultSummary } : {}) };
      const receipt = await record(userId, command, "completed", evidence);
      await transition(userId, command.operatingNodeId, result?.terminalState === "in_progress" ? { status: "active", nextAction: "Resume the same objective and Mac job checkpoint." } : { status: "verified", verification: `Connector completion receipt ${receipt.receiptId}` }).catch(() => {});
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
    if (duplicate) return { commandId: command.id, objectiveId: command.objectiveId, status: command.status, duplicate: true, result: command.result || null };
    return run(userId, command);
  }
  async function status(userId = "primary", id) {
    const state = await read(userId); const command = state.commands.find((row) => row.id === id); if (!command) return null;
    const response = { ...command, events: state.events.filter((row) => row.commandId === id), receipts: state.receipts.filter((row) => row.commandId === id) };
    if (command.routing?.capability === "primary_mac.agent.maintenance") {
      const ids = new Set((command.result?.jobs || []).map((job) => job.id));
      response.macJobs = (await listMacJobs(userId, 500)).filter((job) => ids.has(job.id)).map((job) => ({ id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, attempts: job.attempts, claimedAt: job.claimedAt, completedAt: job.completedAt, error: job.error, dispatchReceipt: job.dispatchReceipt }));
      response.macDevices = getMacDeviceStatus();
    }
    const jobId = clean(command.result?.job?.id || command.metadata?.existing_job_id || command.metadata?.existingJobId, 200);
    if (jobId && command.objectiveId) {
      const job = (await listMacJobs(userId, 500)).find((item) => item.id === jobId && String(item.args?.objectiveId || "") === command.objectiveId);
      if (job) response.macJob = { id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, authority: job.args?.authority || null, checkpoint: job.args?.checkpoint || null, attempts: job.attempts, claimedAt: job.claimedAt, completedAt: job.completedAt, error: job.error, dispatchReceipt: job.dispatchReceipt, cursor: job.result?.mailboxEvidenceBatch?.cursor || {}, packetCount: job.result?.mailboxEvidenceBatch?.packets?.length || 0, quarantineCount: job.result?.quarantine?.length || job.result?.mailboxEvidenceBatch?.quarantine?.length || 0, connections: job.result?.connection || null };
      response.packetManifests = await listMailboxPacketManifests(userId, { objectiveId: command.objectiveId, limit: 25 });
    }
    return response;
  }
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
