import crypto from "node:crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { executeTool } from "./tools.js";
import { recoveryDecision, resetStepAttempts, reliabilityReceipt } from "./operator-reliability-v2.js";

const LEGACY_NS = "durable_objective_worker_v1";
export const OBJECTIVE_LANES = Object.freeze(["general", "engineering", "seo", "closing"]);
const USER = () => process.env.GEORGIE_EXECUTIVE_USER_ID || process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const INTERVAL = Math.max(15_000, Number(process.env.GEORGIE_OBJECTIVE_WORKER_INTERVAL_MS || 30_000));
const LEASE_MS = Math.max(30_000, Number(process.env.GEORGIE_OBJECTIVE_LEASE_MS || 120_000));
const MAX_OBJECTIVES = 1000;
const timers = new Map();
const runningLanes = new Set();

const now = () => new Date().toISOString();
const clean = (v, max = 1000) => String(v ?? "").trim().slice(0, max);
const SECRET_KEY = /(password|secret|token|private.?key|authorization|cookie|credential)/i;

function sanitize(value, depth = 0) {
  if (depth > 5) return "[bounded]";
  if (Array.isArray(value)) return value.slice(0, 50).map(v => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 100)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : sanitize(v, depth + 1);
    return out;
  }
  if (typeof value === "string") return value.slice(0, 2000);
  if (["number", "boolean"].includes(typeof value) || value == null) return value;
  return String(value).slice(0, 500);
}

export function objectiveLane(value = "general") {
  const domain = clean(value, 80).toLowerCase();
  if (/seo|wordpress|search/.test(domain)) return "seo";
  if (/clos|outreach|smartlead|email|client/.test(domain)) return "closing";
  if (/engineer|technical|github|deploy|repair|sierra|crm|capitalmatch|cm-?100|underwriting/.test(domain)) return "engineering";
  return "general";
}
function namespaceForLane(lane) { return lane === "general" ? LEGACY_NS : `${LEGACY_NS}:${lane}`; }
async function readStore(userId, lane = "general") {
  const store = await readCloudState(String(userId || "primary"), namespaceForLane(objectiveLane(lane)), { version: 1, objectives: [], updatedAt: null });
  return { version: 1, objectives: Array.isArray(store.objectives) ? store.objectives : [], updatedAt: store.updatedAt || null };
}
async function saveStore(userId, store, lane = "general") {
  const next = { version: 1, objectives: store.objectives.slice(-MAX_OBJECTIVES), updatedAt: now() };
  const saved = await writeCloudState(String(userId || "primary"), namespaceForLane(objectiveLane(lane)), next);
  if (!saved) throw new Error("Durable objective worker storage unavailable");
  return next;
}

function normalizeStep(step = {}, index = 0) {
  const tool = clean(step.tool, 160);
  if (!tool) throw new Error(`Objective step ${index + 1} requires a governed tool`);
  return {
    id: clean(step.id || `step-${index + 1}`, 120),
    tool,
    args: sanitize(step.args || {}),
    policy: ["read", "low_risk_write", "sensitive_write", "external_side_effect"].includes(step.policy) ? step.policy : "low_risk_write",
    verification: step.verification?.tool ? { tool: clean(step.verification.tool, 160), args: sanitize(step.verification.args || {}), expect: sanitize(step.verification.expect) } : null,
    delayMsAfter: Math.max(0, Math.min(Number(step.delayMsAfter || 0), 86_400_000)),
    requiresApproval: Boolean(step.requiresApproval)
  };
}

export async function scheduleObjective(userId, input = {}) {
  const stableKey = clean(input.stableKey || input.idempotencyKey, 200);
  if (!stableKey) throw new Error("stableKey or idempotencyKey is required");
  const steps = (Array.isArray(input.steps) ? input.steps : []).map(normalizeStep);
  if (!steps.length) throw new Error("At least one objective step is required");
  const lane = objectiveLane(input.lane || input.domain);
  const store = await readStore(userId, lane);
  let objective = store.objectives.find(o => o.stableKey === stableKey && o.status !== "cancelled");
  if (objective && objective.status === "blocked" && input.resumeBlocked === true) {
    objective.status = "queued";
    objective.attempts = 0;
    objective.lease = null;
    objective.nextRunAt = now();
    objective.checkpoint = { ...objective.checkpoint, lastStatus: "queued", lastError: null, resumedAt: now() };
    await persistObjective(userId, objective, lane);
    return { status: "resumed", objective };
  }
  if (objective) return { status: "deduplicated", objective };
  objective = {
    id: crypto.randomUUID(), stableKey, title: clean(input.title || stableKey, 300), domain: clean(input.domain || "general", 80), lane,
    status: "queued", priority: ["urgent", "high", "normal", "low"].includes(input.priority) ? input.priority : "normal",
    steps, stepIndex: 0, attempts: 0, attemptsByStep: {}, recoveryTrail: [], maxAttempts: Math.max(1, Math.min(Number(input.maxAttempts || 8), 25)),
    approvalId: clean(input.approvalId, 160) || null, nextRunAt: input.nextRunAt || now(), lease: null,
    checkpoint: { createdAt: now(), lastStepId: null, lastStatus: "queued", lastError: null }, evidence: [],
    createdAt: now(), updatedAt: now()
  };
  store.objectives.push(objective);
  await saveStore(userId, store, lane);
  return { status: "queued", objective };
}

export async function listScheduledObjectives(userId, { status = "active", limit = 50 } = {}) {
  const stores = await Promise.all(OBJECTIVE_LANES.map(lane => readStore(userId, lane)));
  const store = { objectives: stores.flatMap(item => item.objectives) };
  const active = new Set(["queued", "running", "waiting", "waiting_approval", "recovering"]);
  return store.objectives.filter(o => status === "all" || (status === "active" ? active.has(o.status) : o.status === status))
    .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(Number(limit)||50,200)));
}

function priorityWeight(p) { return ({ urgent: 4, high: 3, normal: 2, low: 1 })[p] || 0; }
function runnable(o, at = Date.now()) {
  if (!["queued", "running", "waiting", "recovering"].includes(o.status)) return false;
  if (o.nextRunAt && new Date(o.nextRunAt).getTime() > at) return false;
  if (o.lease?.until && new Date(o.lease.until).getTime() > at) return false;
  return true;
}

async function persistObjective(userId, objective, lane = objective.lane || objective.domain) {
  const resolvedLane = objectiveLane(lane);
  const store = await readStore(userId, resolvedLane);
  const i = store.objectives.findIndex(o => o.id === objective.id);
  if (i < 0) return false;
  store.objectives[i] = { ...objective, updatedAt: now() };
  await saveStore(userId, store, resolvedLane);
  return true;
}

function startLeaseHeartbeat(userId, objective, workerId, lane) {
  const intervalMs = Math.max(10_000, Math.floor(LEASE_MS / 3));
  const heartbeat = setInterval(() => {
    if (objective.lease?.owner !== workerId) return;
    objective.lease = { ...objective.lease, heartbeatAt: now(), until: new Date(Date.now() + LEASE_MS).toISOString() };
    void persistObjective(userId, objective, lane).catch(error => console.warn("Objective lease heartbeat failed:", error instanceof Error ? error.message : error));
  }, intervalMs);
  heartbeat.unref?.();
  return () => clearInterval(heartbeat);
}

function expectationMatches(actual, expected) {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((v,i) => expectationMatches(actual[i], v));
  if (expected && typeof expected === "object") return actual && typeof actual === "object" && Object.entries(expected).every(([k,v]) => expectationMatches(actual[k], v));
  return Object.is(actual, expected);
}

export async function runObjectiveWorkerCycle(userId = USER(), requestedLane = "general") {
  const lane = objectiveLane(requestedLane);
  if (runningLanes.has(lane)) return { status: "busy", lane };
  runningLanes.add(lane);
  try {
    const store = await readStore(userId, lane);
    const objective = store.objectives.filter(o => runnable(o)).sort((a,b) => priorityWeight(b.priority)-priorityWeight(a.priority) || String(a.updatedAt).localeCompare(String(b.updatedAt)))[0];
    if (!objective) return { status: "idle", lane };
    const workerId = `${process.env.RENDER_INSTANCE_ID || process.pid}:${crypto.randomUUID().slice(0,8)}`;
    objective.lease = { owner: workerId, claimedAt: now(), until: new Date(Date.now()+LEASE_MS).toISOString() };
    objective.status = objective.status === "running" ? "recovering" : "running";
    objective.attempts = Number(objective.attempts || 0) + 1; objective.attemptsByStep = objective.attemptsByStep || {}; objective.recoveryTrail = Array.isArray(objective.recoveryTrail) ? objective.recoveryTrail : [];
    await persistObjective(userId, objective, lane);

    const step = objective.steps[objective.stepIndex];
    if (!step) {
      const receipt = reliabilityReceipt({ objective, terminalStatus: "verified", evidence: objective.evidence });
      objective.status = "verified"; objective.lease = null; objective.completionReceipt = receipt; objective.checkpoint = { ...objective.checkpoint, lastStatus: "verified", completedAt: now() };
      await persistObjective(userId, objective, lane); return { status: "verified", lane, objectiveId: objective.id, receipt };
    }
    if (step.requiresApproval && !objective.approvalId) {
      objective.status = "waiting_approval"; objective.lease = null; objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: "waiting_approval", lastError: null };
      await persistObjective(userId, objective, lane); return { status: "waiting_approval", lane, objectiveId: objective.id, step: step.id };
    }

    const args = { ...step.args };
    if (objective.approvalId) args._governance = { ...(args._governance || {}), approvalId: objective.approvalId, idempotencyKey: `${objective.stableKey}:${step.id}` };
    const stopHeartbeat = startLeaseHeartbeat(userId, objective, workerId, lane);
    let execution;
    try { execution = await executeTool({ name: step.tool, args, userId, policy: objective.approvalId ? "external_side_effect" : step.policy }); }
    finally { stopHeartbeat(); }
    if (!execution.ok) {
      objective.lease = null;
      const recovery = recoveryDecision({ stepId: step.id, attemptsByStep: objective.attemptsByStep, maxAttempts: objective.maxAttempts, error: execution.error || execution.blockedBy || "execution_failed", approvalRequired: execution.approvalRequired });
      objective.attemptsByStep = { ...objective.attemptsByStep, [step.id]: recovery.attempts };
      objective.recoveryTrail = [...objective.recoveryTrail, recovery.recoveryEvent].slice(-100);
      objective.status = recovery.status;
      objective.nextRunAt = recovery.nextRunAt || objective.nextRunAt;
      objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: objective.status, lastError: clean(execution.error || execution.blockedBy || "execution_failed", 1000), lastFailureClass: recovery.failureClass, stepAttempt: recovery.attempts };
      objective.evidence.push({ at: now(), stepId: step.id, tool: step.tool, state: objective.status, ref: execution.result?.dispatchReceipt?.id || null });
      await persistObjective(userId, objective, lane);
      return { status: objective.status, lane, objectiveId: objective.id, step: step.id };
    }

    let verification = null;
    if (step.verification) {
      verification = await executeTool({ name: step.verification.tool, args: step.verification.args, userId, policy: "read" });
      const satisfied = verification.ok && expectationMatches(verification.result, step.verification.expect);
      if (!satisfied) {
        objective.lease = null; objective.status = objective.attempts >= objective.maxAttempts ? "blocked" : "recovering";
        objective.nextRunAt = new Date(Date.now() + 30_000).toISOString();
        objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: objective.status, lastError: "verification_not_satisfied" };
        objective.evidence.push({ at: now(), stepId: step.id, tool: step.tool, verificationTool: step.verification.tool, state: "verification_pending" });
        await persistObjective(userId, objective, lane);
        return { status: objective.status, lane, objectiveId: objective.id, step: step.id };
      }
    }

    objective.evidence.push({ at: now(), stepId: step.id, tool: step.tool, state: "verified", verificationTool: step.verification?.tool || null, ref: execution.result?.dispatchReceipt?.id || null });
    objective.stepIndex += 1; objective.lease = null; objective.attempts = 0; objective.attemptsByStep = resetStepAttempts(objective.attemptsByStep, step.id);
    objective.status = objective.stepIndex >= objective.steps.length ? "verified" : "queued";
    if (objective.status === "verified") objective.completionReceipt = reliabilityReceipt({ objective, terminalStatus: "verified", evidence: objective.evidence });
    objective.nextRunAt = new Date(Date.now() + step.delayMsAfter).toISOString();
    objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: objective.status, lastError: null, lastVerifiedAt: now() };
    await persistObjective(userId, objective, lane);
    return { status: objective.status, lane, objectiveId: objective.id, step: step.id, nextStepIndex: objective.stepIndex, receipt: objective.completionReceipt || null };
  } finally { runningLanes.delete(lane); }
}

export function startObjectiveWorker() {
  if (timers.size) return;
  for (const lane of OBJECTIVE_LANES) {
    void runObjectiveWorkerCycle(USER(), lane);
    const timer = setInterval(() => void runObjectiveWorkerCycle(USER(), lane).catch(e => console.warn(`Objective worker ${lane} cycle failed:`, e instanceof Error ? e.message : e)), INTERVAL);
    timer.unref?.(); timers.set(lane, timer);
  }
}
export function stopObjectiveWorker() { for (const timer of timers.values()) clearInterval(timer); timers.clear(); }
export function objectiveWorkerStatus() { return { running: timers.size > 0, intervalMs: INTERVAL, leaseMs: LEASE_MS, lanes: [...OBJECTIVE_LANES], activeLanes: [...runningLanes], independentLaneWorkers: true, leaseHeartbeats: true, durableCompletionReceipts: true, durableStorage: true, restartRecovery: true, approvalAware: true, evidenceCheckpointing: true }; }
