import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { listEvents } from "./events.js";
import { listTasks } from "./tasks.js";
import { getSierraHealth, getSierraInfrastructure, getSierraStrategy, sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";
import { evaluationScorecard } from "./evaluation.js";

const DECISIONS_NS = "decision_journal";
const APPROVALS_NS = "approval_control";
const SNAPSHOT_NS = "command_center_snapshot";
const PRIORITY_WEIGHT = { urgent: 100, high: 70, normal: 40, low: 10 };

function bounded(value, max = 2000) { return String(value || "").trim().slice(0, max); }
function validDomain(value) { return ["personal", "household", "sierra", "uncertain"].includes(value) ? value : "uncertain"; }
function now() { return new Date().toISOString(); }
function dueScore(dueAt) {
  if (!dueAt) return 0;
  const hours = (new Date(dueAt).getTime() - Date.now()) / 3600000;
  if (!Number.isFinite(hours)) return 0;
  if (hours <= 0) return 40;
  if (hours <= 24) return 30;
  if (hours <= 72) return 15;
  return 0;
}
function rankItem(item, kind) {
  const priority = ["low", "normal", "high", "urgent"].includes(item.priority) ? item.priority : "normal";
  return {
    id: item.id,
    kind,
    title: bounded(item.title, 300),
    detail: bounded(kind === "task" ? item.notes : item.body, 1200),
    priority,
    domain: validDomain(item.domain || item.data?.domain),
    dueAt: item.dueAt || item.data?.dueAt || null,
    source: bounded(item.source || item.type, 200),
    evidence: item.data?.evidence || null,
    createdAt: item.createdAt,
    score: PRIORITY_WEIGHT[priority] + dueScore(item.dueAt || item.data?.dueAt)
  };
}

async function readList(userId, namespace, key) {
  const state = await readCloudState(userId, namespace, { [key]: [] });
  return Array.isArray(state[key]) ? state[key] : [];
}
async function writeList(userId, namespace, key, items) {
  return writeCloudState(userId, namespace, { [key]: items.slice(-5000), updatedAt: now() });
}

export async function recordDecision(userId, input = {}) {
  const uid = String(userId || "primary");
  const decisions = await readList(uid, DECISIONS_NS, "decisions");
  const entry = {
    id: crypto.randomUUID(),
    userId: uid,
    domain: validDomain(input.domain),
    context: bounded(input.context, 4000),
    evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {},
    recommendation: bounded(input.recommendation, 4000),
    decision: ["approved", "rejected", "edited", "deferred", "recorded"].includes(input.decision) ? input.decision : "recorded",
    correction: bounded(input.correction, 4000),
    rationale: bounded(input.rationale, 4000),
    policy: bounded(input.policy, 1200),
    action: bounded(input.action, 2000),
    verification: bounded(input.verification, 2000),
    outcome: bounded(input.outcome, 2000),
    createdAt: now()
  };
  decisions.push(entry);
  await writeList(uid, DECISIONS_NS, "decisions", decisions);
  return entry;
}
export async function listDecisions(userId, { limit = 50, domain = "all" } = {}) {
  const decisions = await readList(String(userId || "primary"), DECISIONS_NS, "decisions");
  return decisions.filter((item) => domain === "all" || item.domain === domain).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

export async function createApprovalRequest(userId, input = {}) {
  const uid = String(userId || "primary");
  const approvals = await readList(uid, APPROVALS_NS, "approvals");
  const item = {
    id: crypto.randomUUID(),
    userId: uid,
    domain: validDomain(input.domain),
    actionType: bounded(input.actionType, 160),
    title: bounded(input.title, 300),
    summary: bounded(input.summary, 3000),
    evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {},
    risk: ["low", "medium", "high", "consequential"].includes(input.risk) ? input.risk : "medium",
    reversible: Boolean(input.reversible),
    verificationMethod: bounded(input.verificationMethod, 1200),
    rollbackPlan: bounded(input.rollbackPlan, 1200),
    status: "pending",
    authority: "prepare_only",
    createdAt: now(),
    decidedAt: null,
    decisionNote: ""
  };
  approvals.push(item);
  await writeList(uid, APPROVALS_NS, "approvals", approvals);
  return item;
}
export async function listApprovals(userId, { status = "pending", limit = 50 } = {}) {
  const approvals = await readList(String(userId || "primary"), APPROVALS_NS, "approvals");
  return approvals.filter((item) => status === "all" || item.status === status).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}
export async function decideApproval(userId, approvalId, { decision, note = "" } = {}) {
  const uid = String(userId || "primary");
  if (!["approved", "rejected", "deferred"].includes(decision)) throw new Error("Decision must be approved, rejected, or deferred");
  const approvals = await readList(uid, APPROVALS_NS, "approvals");
  const item = approvals.find((entry) => entry.userId === uid && entry.id === approvalId);
  if (!item) return null;
  if (item.status !== "pending") throw new Error("Approval request is already decided");
  item.status = decision;
  item.decidedAt = now();
  item.decisionNote = bounded(note, 2000);
  await writeList(uid, APPROVALS_NS, "approvals", approvals);
  await recordDecision(uid, { domain: item.domain, context: item.summary, evidence: item.evidence, recommendation: item.title, decision, rationale: item.decisionNote, action: item.actionType, policy: "prepare_only:no_automatic_execution" });
  return { ...item, executionTriggered: false };
}

async function captureSource(name, fn) {
  const startedAt = now();
  try { return { name, ok: true, observedAt: now(), startedAt, data: await fn() }; }
  catch (error) { return { name, ok: false, observedAt: now(), startedAt, error: error instanceof Error ? error.message : String(error), data: null }; }
}
export async function collectSierraEvidence(userId) {
  const uid = String(userId || "primary");
  if (!sierraWorkforceConfigured()) return { configured: false, coverage: "none", observedAt: now(), sources: [] };
  const sources = await Promise.all([
    captureSource("georgie_workforce_health", () => getSierraHealth(uid)),
    captureSource("georgie_workforce_strategy", () => getSierraStrategy(uid)),
    captureSource("georgie_workforce_infrastructure", () => getSierraInfrastructure(uid))
  ]);
  const snapshot = { configured: true, observedAt: now(), coverage: sources.every((source) => source.ok) ? "three_source_snapshot" : "partial", sources, provesEndToEndHealth: false };
  await writeCloudState(uid, SNAPSHOT_NS, snapshot);
  return snapshot;
}

export async function buildCommandCenter(userId, { refreshSierra = false } = {}) {
  const uid = String(userId || "primary");
  const [tasks, events, approvals, decisions, previousSierra, intelligence] = await Promise.all([
    listTasks(uid, { status: "open", limit: 200 }),
    listEvents(uid, { status: "pending", limit: 200 }),
    listApprovals(uid, { status: "pending", limit: 100 }),
    listDecisions(uid, { limit: 20 }),
    readCloudState(uid, SNAPSHOT_NS, null),
    evaluationScorecard(uid)
  ]);
  const priorities = [...tasks.map((item) => rankItem(item, "task")), ...events.map((item) => rankItem(item, "event"))]
    .sort((a, b) => b.score - a.score || String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")))
    .slice(0, 12);
  const sierra = refreshSierra || !previousSierra ? await collectSierraEvidence(uid) : previousSierra;
  return {
    generatedAt: now(),
    authority: "observe_recommend_prepare",
    executionEnabled: false,
    summary: { openTasks: tasks.length, pendingEvents: events.length, pendingApprovals: approvals.length, recordedDecisions: decisions.length, urgentPriorities: priorities.filter((item) => item.priority === "urgent").length },
    priorities,
    approvals: approvals.slice(0, 10),
    recentDecisions: decisions.slice(0, 10),
    intelligence,
    sierra,
    boundaries: { personalBusinessSeparated: true, approvalRecordsDoNotExecuteActions: true, spendingAuthority: false, externalCommunicationAuthority: false }
  };
}
