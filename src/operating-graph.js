import crypto from "node:crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { listMacJobs } from "./mac/queue.js";

const NS = "operating_intelligence_graph";
const ACTIVE = new Set(["planned", "active", "waiting", "blocked", "recovering"]);
const now = () => new Date().toISOString();
const bounded = (value, max = 2000) => String(value || "").trim().slice(0, max);
const allowedStatus = (value) => ["planned", "active", "waiting", "blocked", "recovering", "verified", "cancelled"].includes(value) ? value : "planned";
const allowedKind = (value) => ["objective", "commitment", "engineering", "investigation", "execution", "follow_up"].includes(value) ? value : "objective";

async function readGraph(userId) {
  return readCloudState(String(userId || "primary"), NS, { version: "2026-08-20.1", nodes: [], edges: [], updatedAt: null });
}

async function writeGraph(userId, graph) {
  const next = { version: "2026-08-20.1", nodes: graph.nodes.slice(-2000), edges: graph.edges.slice(-5000), updatedAt: now() };
  await writeCloudState(String(userId || "primary"), NS, next);
  return next;
}

export async function upsertOperatingNode(userId, input = {}) {
  const graph = await readGraph(userId);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const stableKey = bounded(input.stableKey || "", 200);
  let node = stableKey ? nodes.find((item) => item.stableKey === stableKey) : null;
  if (!node) {
    node = { id: crypto.randomUUID(), createdAt: now(), attempts: 0 };
    nodes.push(node);
  }
  Object.assign(node, {
    stableKey: stableKey || node.stableKey || null,
    kind: allowedKind(input.kind || node.kind),
    title: bounded(input.title || node.title, 300),
    description: bounded(input.description ?? node.description, 4000),
    domain: bounded(input.domain || node.domain || "general", 80),
    status: allowedStatus(input.status || node.status),
    priority: ["low", "normal", "high", "urgent"].includes(input.priority) ? input.priority : node.priority || "normal",
    nextAction: bounded(input.nextAction ?? node.nextAction, 2000),
    verification: bounded(input.verification ?? node.verification, 2000),
    recovery: bounded(input.recovery ?? node.recovery, 2000),
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map((item) => bounded(item, 300)).slice(0, 30) : node.evidenceRefs || [],
    approvalId: bounded(input.approvalId || node.approvalId, 120) || null,
    dueAt: input.dueAt || node.dueAt || null,
    updatedAt: now(),
  });
  if (input.parentId && input.parentId !== node.id && !edges.some((edge) => edge.from === input.parentId && edge.to === node.id && edge.type === "contains")) {
    edges.push({ id: crypto.randomUUID(), from: bounded(input.parentId, 120), to: node.id, type: "contains", createdAt: now() });
  }
  await writeGraph(userId, { nodes, edges });
  return node;
}

export async function transitionOperatingNode(userId, nodeId, input = {}) {
  const graph = await readGraph(userId);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const node = nodes.find((item) => item.id === String(nodeId || ""));
  if (!node) return null;
  const previous = node.status;
  node.status = allowedStatus(input.status);
  node.nextAction = bounded(input.nextAction ?? node.nextAction, 2000);
  node.verification = bounded(input.verification ?? node.verification, 2000);
  node.recovery = bounded(input.recovery ?? node.recovery, 2000);
  node.attempts = Number(node.attempts || 0) + (input.attempted ? 1 : 0);
  node.updatedAt = now();
  if (node.status === "verified") node.verifiedAt = now();
  await writeGraph(userId, { nodes, edges: Array.isArray(graph.edges) ? graph.edges : [] });
  return { ...node, previousStatus: previous };
}

export function deriveContinuity(nodes = [], jobs = [], limit = 50) {
  const unfinishedJobs = jobs.filter((job) => ["queued", "claimed"].includes(job.status)).map((job) => ({ id: job.id, kind: "mac_job", action: job.action, status: job.status, createdAt: job.createdAt, durable: true }));
  const priorityWeight = { urgent: 4, high: 3, normal: 2, low: 1 };
  const activeNodes = nodes.filter((item) => ACTIVE.has(item.status)).sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
  return {
    activeNodes,
    unfinishedJobs,
    nextActions: activeNodes.filter((item) => item.nextAction).slice(0, 10).map((item) => ({ id: item.id, title: item.title, domain: item.domain, priority: item.priority, nextAction: item.nextAction, approvalId: item.approvalId || null })),
    counts: { activeNodes: activeNodes.length, unfinishedJobs: unfinishedJobs.length, blocked: activeNodes.filter((item) => item.status === "blocked").length, waiting: activeNodes.filter((item) => item.status === "waiting").length },
  };
}

export async function operatingContinuity(userId, { limit = 50 } = {}) {
  const graph = await readGraph(userId);
  const nodes = (Array.isArray(graph.nodes) ? graph.nodes : []).filter((item) => ACTIVE.has(item.status));
  const jobs = await listMacJobs(userId, 200);
  const derived = deriveContinuity(nodes, jobs, limit);
  return {
    version: graph.version || "2026-08-20.1",
    generatedAt: now(),
    ...derived,
    authority: "observe_recommend_prepare",
  };
}

export function continuationRecordForTurn(sessionId, input, response = {}) {
  const outcome = response.outcome;
  if (!outcome?.requiresFollowUp && !outcome?.requiresRecovery) return null;
  const tools = Array.isArray(outcome.actions) ? outcome.actions.map((item) => item.tool).filter(Boolean) : [];
  const sensitive = tools.includes("system.create_enrollment_code");
  const fingerprint = crypto.createHash("sha256").update(`${sessionId}:${bounded(input, 1000)}:${tools.join(",")}`).digest("hex").slice(0, 24);
  return {
    stableKey: `turn-continuation:${fingerprint}`,
    kind: tools.some((tool) => tool.startsWith("developer.")) ? "engineering" : "execution",
    title: sensitive ? "Resume protected device enrollment work" : bounded(input, 240) || "Resume unfinished Georgie work",
    description: "Automatically retained from a nonterminal tool outcome. Raw tool payloads and sensitive response text are not stored.",
    domain: response.route?.domain || "general",
    status: outcome.requiresRecovery ? "recovering" : "waiting",
    priority: outcome.requiresRecovery ? "high" : "normal",
    nextAction: outcome.requiresRecovery ? "Inspect the failed action evidence, execute the bounded recovery path, and verify the requested outcome." : "Recheck the durable job status, continue from verified partial evidence, and report the terminal outcome.",
    recovery: outcome.requiresRecovery ? "Retry only the failed bounded action after confirming authority and current evidence." : "Resume the existing durable job; do not create a duplicate action.",
    evidenceRefs: [...tools.map((tool) => `tool:${tool}`), ...(outcome.pendingJobIds || []).map((id) => `job:${id}`)],
  };
}

export async function retainTurnContinuation(userId, sessionId, input, response = {}) {
  const record = continuationRecordForTurn(sessionId, input, response);
  return record ? upsertOperatingNode(userId, record) : null;
}
