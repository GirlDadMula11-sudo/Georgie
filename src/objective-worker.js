import crypto from "node:crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { executeTool } from "./tools.js";

const NS = "durable_objective_worker_v1";
const USER = () => process.env.GEORGIE_EXECUTIVE_USER_ID || process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const INTERVAL = Math.max(15_000, Number(process.env.GEORGIE_OBJECTIVE_WORKER_INTERVAL_MS || 30_000));
const LEASE_MS = Math.max(30_000, Number(process.env.GEORGIE_OBJECTIVE_LEASE_MS || 120_000));
const MAX_OBJECTIVES = 1000;
let timer = null;
let running = false;

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

async function readStore(userId) {
  const store = await readCloudState(String(userId || "primary"), NS, { version: 1, objectives: [], updatedAt: null });
  return { version: 1, objectives: Array.isArray(store.objectives) ? store.objectives : [], updatedAt: store.updatedAt || null };
}
async function saveStore(userId, store) {
  const next = { version: 1, objectives: store.objectives.slice(-MAX_OBJECTIVES), updatedAt: now() };
  const saved = await writeCloudState(String(userId || "primary"), NS, next);
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
  const store = await readStore(userId);
  let objective = store.objectives.find(o => o.stableKey === stableKey && !["cancelled", "verified"].includes(o.status));
  if (objective && objective.status === "blocked" && input.resumeBlocked === true) {
    objective.status = "queued";
    objective.attempts = 0;
    objective.lease = null;
    objective.nextRunAt = now();
    objective.checkpoint = { ...objective.checkpoint, lastStatus: "queued", lastError: null, resumedAt: now() };
    await persistObjective(userId, objective);
    return { status: "resumed", objective };
  }
  if (objective) return { status: "deduplicated", objective };
  objective = {
    id: crypto.randomUUID(), stableKey, title: clean(input.title || stableKey, 300), domain: clean(input.domain || "general", 80),
    status: "queued", priority: ["urgent", "high", "normal", "low"].includes(input.priority) ? input.priority : "normal",
    steps, stepIndex: 0, attempts: 0, maxAttempts: Math.max(1, Math.min(Number(input.maxAttempts || 8), 25)),
    approvalId: clean(input.approvalId, 160) || null, nextRunAt: input.nextRunAt || now(), lease: null,
    checkpoint: { createdAt: now(), lastStepId: null, lastStatus: "queued", lastError: null }, evidence: [],
    createdAt: now(), updatedAt: now()
  };
  store.objectives.push(objective);
  await saveStore(userId, store);
  return { status: "queued", objective };
}

export async function listScheduledObjectives(userId, { status = "active", limit = 50 } = {}) {
  const store = await readStore(userId);
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

async function persistObjective(userId, objective) {
  const store = await readStore(userId);
  const i = store.objectives.findIndex(o => o.id === objective.id);
  if (i < 0) return false;
  store.objectives[i] = { ...objective, updatedAt: now() };
  await saveStore(userId, store);
  return true;
}

function expectationMatches(actual, expected) {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((v,i) => expectationMatches(actual[i], v));
  if (expected && typeof expected === "object") return actual && typeof actual === "object" && Object.entries(expected).every(([k,v]) => expectationMatches(actual[k], v));
  return Object.is(actual, expected);
}

export async function runObjectiveWorkerCycle(userId = USER()) {
  if (running) return { status: "busy" };
  running = true;
  try {
    const store = await readStore(userId);
    const objective = store.objectives.filter(o => runnable(o)).sort((a,b) => priorityWeight(b.priority)-priorityWeight(a.priority) || String(a.updatedAt).localeCompare(String(b.updatedAt)))[0];
    if (!objective) return { status: "idle" };
    const workerId = `${process.env.RENDER_INSTANCE_ID || process.pid}:${crypto.randomUUID().slice(0,8)}`;
    objective.lease = { owner: workerId, claimedAt: now(), until: new Date(Date.now()+LEASE_MS).toISOString() };
    objective.status = objective.status === "running" ? "recovering" : "running";
    objective.attempts = Number(objective.attempts || 0) + 1;
    await persistObjective(userId, objective);

    const step = objective.steps[objective.stepIndex];
    if (!step) {
      objective.status = "verified"; objective.lease = null; objective.checkpoint = { ...objective.checkpoint, lastStatus: "verified", completedAt: now() };
      await persistObjective(userId, objective); return { status: "verified", objectiveId: objective.id };
    }
    if (step.requiresApproval && !objective.approvalId) {
      objective.status = "waiting_approval"; objective.lease = null; objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: "waiting_approval", lastError: null };
      await persistObjective(userId, objective); return { status: "waiting_approval", objectiveId: objective.id, step: step.id };
    }

    const args = { ...step.args };
    if (objective.approvalId) args._governance = { ...(args._governance || {}), approvalId: objective.approvalId, idempotencyKey: `${objective.stableKey}:${step.id}` };
    const execution = await executeTool({ name: step.tool, args, userId, policy: objective.approvalId ? "external_side_effect" : step.policy });
    if (!execution.ok) {
      objective.lease = null;
      objective.status = execution.approvalRequired ? "waiting_approval" : (objective.attempts >= objective.maxAttempts ? "blocked" : "recovering");
      objective.nextRunAt = new Date(Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(objective.attempts, 6))).toISOString();
      objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: objective.status, lastError: clean(execution.error || execution.blockedBy || "execution_failed", 1000) };
      objective.evidence.push({ at: now(), stepId: step.id, tool: step.tool, state: objective.status, ref: execution.result?.dispatchReceipt?.id || null });
      await persistObjective(userId, objective);
      return { status: objective.status, objectiveId: objective.id, step: step.id };
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
        await persistObjective(userId, objective);
        return { status: objective.status, objectiveId: objective.id, step: step.id };
      }
    }

    objective.evidence.push({ at: now(), stepId: step.id, tool: step.tool, state: "verified", verificationTool: step.verification?.tool || null, ref: execution.result?.dispatchReceipt?.id || null });
    objective.stepIndex += 1; objective.lease = null; objective.attempts = 0;
    objective.status = objective.stepIndex >= objective.steps.length ? "verified" : "queued";
    objective.nextRunAt = new Date(Date.now() + step.delayMsAfter).toISOString();
    objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: objective.status, lastError: null, lastVerifiedAt: now() };
    await persistObjective(userId, objective);
    return { status: objective.status, objectiveId: objective.id, step: step.id, nextStepIndex: objective.stepIndex };
  } finally { running = false; }
}

export function startObjectiveWorker() {
  if (timer) return;
  void runObjectiveWorkerCycle();
  timer = setInterval(() => void runObjectiveWorkerCycle().catch(e => console.warn("Objective worker cycle failed:", e instanceof Error ? e.message : e)), INTERVAL);
  timer.unref?.();
}
export function stopObjectiveWorker() { if (timer) clearInterval(timer); timer = null; }
export function objectiveWorkerStatus() { return { running: Boolean(timer), intervalMs: INTERVAL, leaseMs: LEASE_MS, durableStorage: true, restartRecovery: true, approvalAware: true, evidenceCheckpointing: true }; }
