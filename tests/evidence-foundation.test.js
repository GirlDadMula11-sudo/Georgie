import test from "node:test";
import assert from "node:assert/strict";
import { buildDealEvidenceGraph, normalizeGuardedConflicts, summarizeInvestigationSteps } from "../src/evidence-foundation.js";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("guarded conflict intelligence preserves both evidence records and explicit unknowns", () => {
  const result = normalizeGuardedConflicts([{ conflict_id: "conflict-1", deal_id: "deal-7", sca_reference: "SCA-77", workflow_stage: "lender_response", evidence_records: [{ id: "a", field: "status", value: "approved", source_system: "lender_api", confidence: 0.98 }, { id: "b", field: "status", value: "declined", source_system: "email", confidence: 0.8 }], field_differences: [{ field: "status", values: ["approved", "declined"] }] }]);
  assert.equal(result.contract, "georgie.guarded-conflict.v1");
  assert.equal(result.conflicts[0].evidenceRecords.length, 2);
  assert.deepEqual(result.conflicts[0].evidenceRecords.map(item => item.value), ["approved", "declined"]);
  assert.ok(result.conflicts[0].unknownFields.includes("authority.policy"));
  assert.equal(result.writesPerformed, false);
});

test("deal evidence graph always models all ten stages without inventing missing state", () => {
  const graph = buildDealEvidenceGraph({ reference: "SCA-77", sources: { deal: { deal_id: "deal-7", status: "underwriting", workflow_stage: "underwriting" }, documentManifest: [] } });
  assert.equal(graph.nodes.length, 10);
  assert.equal(graph.edges.length, 9);
  assert.equal(graph.nodes.at(-1).stage, "crm_accounting");
  assert.ok(graph.unknowns.some(field => field.startsWith("funding.")));
  assert.equal(graph.contradictionsPreserved, true);
  assert.equal(graph.writesPerformed, false);
});

test("investigation synthesis reports independent failures as evidence gaps", () => {
  const synthesis = summarizeInvestigationSteps([{ tool: "sierra.health", status: "completed", completedAt: "2026-08-20T20:00:00Z", result: {} }, { tool: "sierra.infrastructure", status: "failed", error: "timeout" }]);
  assert.equal(synthesis.coverage, 0.5);
  assert.deepEqual(synthesis.evidenceGaps, [{ tool: "sierra.infrastructure", error: "timeout" }]);
});

test("high-value evidence requests route to the new governed foundation", () => {
  assert.equal(deterministicToolPlan("Inspect the guarded lender evidence conflict for SCA-77")[0].tool, "sierra.guarded_conflict_intelligence");
  assert.equal(deterministicToolPlan("Run a durable cross-system diagnostic investigation for Sierra")[0].tool, "sierra.diagnostic_investigation");
  assert.equal(deterministicToolPlan("Build the full deal truth evidence graph for SCA-77")[0].tool, "sierra.evidence_graph");
});
