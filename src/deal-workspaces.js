import crypto from "node:crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";

const NS = "deal_intelligence_workspaces";
const VERSION = "2026-08-20.1";
const STAGE_LABELS = {
  lead: "Lead",
  application: "Application",
  documents: "Documents",
  underwriting: "Underwriting",
  capital_match: "CapitalMatch",
  lender_submission: "Lender submission",
  lender_response: "Lender response",
  closing: "Closing",
  funding: "Funding",
  crm_accounting: "CRM & accounting"
};

const clean = (value, max = 300) => String(value || "").trim().slice(0, max);
const now = () => new Date().toISOString();

async function readStore(userId) {
  return readCloudState(String(userId || "primary"), NS, { version: VERSION, workspaces: [] });
}

async function saveStore(userId, store) {
  const saved = await writeCloudState(String(userId || "primary"), NS, {
    version: VERSION,
    updatedAt: now(),
    workspaces: (store.workspaces || []).slice(-500)
  });
  if (!saved) throw new Error("Durable deal-workspace storage is unavailable");
  return saved;
}

function taskMatches(task, reference) {
  const haystack = `${task.title || ""} ${task.notes || ""} ${JSON.stringify(task.evidence || {})}`.toLowerCase();
  return haystack.includes(String(reference || "").toLowerCase());
}

function approvalMatches(approval, reference) {
  const haystack = `${approval.title || ""} ${approval.summary || ""} ${JSON.stringify(approval.evidence || {})}`.toLowerCase();
  return haystack.includes(String(reference || "").toLowerCase());
}

export function deriveDealWorkspace({ reference, graph, documentIntelligence = null, tasks = [], approvals = [], previous = null } = {}) {
  const ref = clean(reference, 100);
  if (!ref) throw new Error("A deal or application reference is required");
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const evidenced = nodes.filter((node) => !node.unknownFields?.includes("sourceEvidence"));
  const currentNode = evidenced.at(-1) || nodes[0] || null;
  const contradictions = Array.isArray(graph?.contradictions) ? graph.contradictions : [];
  const unresolvedConflicts = contradictions.filter((item) => !["resolved", "dismissed"].includes(String(item.status || "").toLowerCase()));
  const documentNode = nodes.find((node) => node.stage === "documents");
  const underwritingNode = nodes.find((node) => node.stage === "underwriting");
  const lenderNode = nodes.find((node) => node.stage === "lender_response") || nodes.find((node) => node.stage === "lender_submission");
  const hasDocumentContract = documentIntelligence?.contract === "georgie.document-intelligence.v1";
  const missingDocuments = hasDocumentContract ? (documentIntelligence.blockers || []).filter((item) => /missing|document|statement/i.test(item)) : documentNode?.unknownFields?.length ? ["Document inventory requires verified source evidence"] : [];
  const blockers = [
    ...(hasDocumentContract ? documentIntelligence.blockers || [] : missingDocuments),
    ...unresolvedConflicts.map((item) => `Resolve ${item.conflictId || "guarded evidence conflict"}`),
    ...(underwritingNode?.unknownFields?.includes("sourceEvidence") ? ["Underwriting evidence is not yet available"] : [])
  ];
  const nextAction = documentIntelligence?.nextAction || blockers[0] || (currentNode ? `Verify the transition after ${STAGE_LABELS[currentNode.stage] || currentNode.stage}` : "Connect the authoritative deal record");
  const timeline = nodes.flatMap((node) => (node.provenance || []).map((source) => ({
    stage: node.stage,
    label: STAGE_LABELS[node.stage] || node.stage,
    state: node.state,
    timestamp: source.timestamp || node.observedAt,
    source: source.source,
    recordId: source.recordId || null
  }))).sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || ""))).slice(0, 100);
  const linkedTasks = tasks.filter((task) => taskMatches(task, ref)).slice(0, 50);
  const linkedApprovals = approvals.filter((approval) => approvalMatches(approval, ref)).slice(0, 50);
  const createdAt = previous?.createdAt || now();
  const snapshot = {
    id: previous?.id || crypto.randomUUID(),
    version: Number(previous?.version || 0) + 1,
    reference: ref,
    title: previous?.title || ref,
    scope: "sierra_deal",
    status: blockers.length ? "blocked" : evidenced.length ? "ready" : "unknown",
    currentStage: currentNode?.stage || "unknown",
    currentStageLabel: currentNode ? STAGE_LABELS[currentNode.stage] || currentNode.stage : "Unknown",
    readiness: { state: blockers.length ? "blocked" : evidenced.length ? "ready" : "unknown", blockers: blockers.length, evidenceCoverage: graph?.coverage?.ratio ?? 0 },
    missingDocuments,
    blockers,
    nextAction,
    financialMetrics: hasDocumentContract ? { status: documentIntelligence.bankStatements?.statements?.length ? "page_cited" : "unknown", values: documentIntelligence.bankStatements?.metrics || {} } : { status: underwritingNode?.unknownFields?.includes("sourceEvidence") ? "unknown" : "evidence_available", values: [] },
    documentIntelligence: hasDocumentContract ? documentIntelligence : null,
    underwriting: { status: underwritingNode?.state || "unknown", confidence: underwritingNode?.confidence ?? null, evidence: underwritingNode?.provenance || [] },
    lenderFit: { status: lenderNode?.state || "unknown", confidence: lenderNode?.confidence ?? null, evidence: lenderNode?.provenance || [] },
    expectedEconomics: { status: "unknown", values: [], note: "Expected economics require verified offers, close probability, and contribution data." },
    conflicts: unresolvedConflicts,
    tasks: linkedTasks,
    approvals: linkedApprovals,
    timeline,
    evidence: { graphContract: graph?.contract || null, observedAt: graph?.observedAt || now(), coverage: graph?.coverage || null, unknowns: graph?.unknowns || [], freshness: graph?.freshness || {}, sourceContracts: graph?.sourceContracts || [] },
    policies: previous?.policies || { memoryScope: "workspace_only", crossWorkspaceAccess: "purpose_required", consequentialActions: "approval_required", retention: "sierra_policy", rawSensitiveDataStored: false },
    instructions: previous?.instructions || "Reconstruct the verified deal truth, preserve contradictions, expose unknowns, and recommend the safest next action.",
    createdAt,
    updatedAt: now()
  };
  return snapshot;
}

export async function saveDealWorkspace(userId, workspace) {
  const store = await readStore(userId);
  const index = (store.workspaces || []).findIndex((item) => item.reference === workspace.reference);
  if (index >= 0) store.workspaces[index] = workspace;
  else store.workspaces = [...(store.workspaces || []), workspace];
  await saveStore(userId, store);
  return workspace;
}

export async function getDealWorkspace(userId, reference) {
  const store = await readStore(userId);
  return (store.workspaces || []).find((item) => item.reference === clean(reference, 100)) || null;
}

export async function listDealWorkspaces(userId, { limit = 50 } = {}) {
  const store = await readStore(userId);
  return (store.workspaces || []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}

export async function refreshDealWorkspace(userId, { reference, graph, documentIntelligence = null, tasks = [], approvals = [] } = {}) {
  const previous = await getDealWorkspace(userId, reference);
  return saveDealWorkspace(userId, deriveDealWorkspace({ reference, graph, documentIntelligence, tasks, approvals, previous }));
}
