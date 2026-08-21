import test from "node:test";
import assert from "node:assert/strict";
import { deriveDealWorkspace } from "../src/deal-workspaces.js";
import { deterministicToolPlan } from "../src/fast-intents.js";

function graph(overrides = {}) {
  return {
    contract: "georgie.deal-evidence-graph.v1",
    observedAt: "2026-08-20T20:00:00.000Z",
    coverage: { evidencedStages: 2, totalStages: 10, ratio: 0.2 },
    unknowns: ["documents.sourceEvidence"],
    freshness: { deal: "2026-08-20T20:00:00.000Z" },
    sourceContracts: ["deal"],
    nodes: [
      { stage: "lead", state: "verified", observedAt: "2026-08-20T19:00:00.000Z", unknownFields: [], provenance: [{ source: "deal", recordId: "lead-1", timestamp: "2026-08-20T19:00:00.000Z" }] },
      { stage: "application", state: "received", observedAt: "2026-08-20T20:00:00.000Z", unknownFields: [], provenance: [{ source: "deal", recordId: "app-1", timestamp: "2026-08-20T20:00:00.000Z" }] },
      { stage: "documents", state: "unknown", observedAt: "2026-08-20T20:00:00.000Z", unknownFields: ["sourceEvidence"], provenance: [] },
      { stage: "underwriting", state: "unknown", observedAt: "2026-08-20T20:00:00.000Z", unknownFields: ["sourceEvidence"], provenance: [] }
    ],
    contradictions: [],
    ...overrides
  };
}

test("derives a source-linked blocked workspace without inventing financial values", () => {
  const workspace = deriveDealWorkspace({ reference: "CM-100", graph: graph() });
  assert.equal(workspace.reference, "CM-100");
  assert.equal(workspace.currentStage, "application");
  assert.equal(workspace.status, "blocked");
  assert.equal(workspace.financialMetrics.status, "unknown");
  assert.deepEqual(workspace.financialMetrics.values, []);
  assert.match(workspace.nextAction, /Document inventory/i);
  assert.equal(workspace.timeline[0].recordId, "app-1");
  assert.equal(workspace.policies.rawSensitiveDataStored, false);
});

test("links only tasks and approvals scoped to the workspace reference", () => {
  const workspace = deriveDealWorkspace({
    reference: "CM-100", graph: graph(),
    tasks: [{ id: "1", title: "Collect statements for CM-100" }, { id: "2", title: "Different deal" }],
    approvals: [{ id: "a", title: "Submit CM-100", status: "pending" }, { id: "b", title: "Submit CM-200", status: "pending" }]
  });
  assert.deepEqual(workspace.tasks.map((item) => item.id), ["1"]);
  assert.deepEqual(workspace.approvals.map((item) => item.id), ["a"]);
});

test("preserves guarded conflicts and makes them visible blockers", () => {
  const conflict = { conflictId: "conflict-7", status: "open", workflowStage: "lender_response", recommendation: "Review authority" };
  const workspace = deriveDealWorkspace({ reference: "SCA-77", graph: graph({ contradictions: [conflict] }) });
  assert.equal(workspace.conflicts[0].conflictId, "conflict-7");
  assert.ok(workspace.blockers.some((item) => item.includes("conflict-7")));
});

test("routes a named deal workspace request directly to the governed workspace tool", () => {
  assert.deepEqual(deterministicToolPlan("Open the deal intelligence workspace for CM-100"), [
    { tool: "sierra.deal_workspace", args: { reference: "CM-100" } }
  ]);
});
