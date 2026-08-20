import { listApprovals, listDecisions } from "./command-layer.js";
import { listEvents } from "./events.js";
import { listTasks } from "./tasks.js";
import { selectDomainPacks } from "./domain-packs.js";
import { operatingContinuity } from "./operating-graph.js";

function compact(item, kind) { return { id: item.id, kind, title: String(item.title || item.actionType || item.context || "Untitled").slice(0, 300), domain: item.domain || item.data?.domain || "uncertain", priority: item.priority || item.risk || "normal", dueAt: item.dueAt || item.data?.dueAt || null, status: item.status || null, createdAt: item.createdAt || null }; }
export async function buildWorldState(userId, input = "", route = {}) {
  const uid = String(userId || "primary");
  const [tasks, events, approvals, decisions, continuity] = await Promise.all([listTasks(uid, { status: "open", limit: 100 }), listEvents(uid, { status: "pending", limit: 100 }), listApprovals(uid, { status: "pending", limit: 50 }), listDecisions(uid, { limit: 30, domain: "all" }), operatingContinuity(uid, { limit: 50 })]);
  const commitments = [...tasks.map((item) => compact(item, "task")), ...events.map((item) => compact(item, "event")), ...approvals.map((item) => compact(item, "approval"))].sort((a, b) => String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999"))).slice(0, 20);
  return { version: "2026-08-20.2", generatedAt: new Date().toISOString(), userId: uid, activePacks: selectDomainPacks(input, route.domain), focusDomain: route.domain || "general", commitments, continuity, recentDecisions: decisions.slice(0, 10).map(({ id, domain, decision, recommendation, rationale, createdAt }) => ({ id, domain, decision, recommendation, rationale, createdAt })), counts: { openTasks: tasks.length, pendingEvents: events.length, pendingApprovals: approvals.length, activeOperatingNodes: continuity.counts.activeNodes, unfinishedDurableJobs: continuity.counts.unfinishedJobs }, truth: { currentEvidenceRequiredForChangingFacts: true, inferenceMustBeLabeled: true, completedActionsRequireVerification: true }, boundaries: { crossDomainDataRequiresPurpose: true, consequentialActionsRequireApproval: true } };
}
