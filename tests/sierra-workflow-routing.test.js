import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("broad Sierra workflow-alignment requests use the governed multi-contract read plan", () => {
  const plan = deterministicToolPlan("Georgie man, the system needs alignment with our intake processing system going into Capital Match, the underwriting flow, and the whole submission flow entirely. Please help us—what's going on?");
  assert.deepEqual(plan.map((step) => step.tool), [
    "sierra.health",
    "sierra.infrastructure",
    "sierra.apply_inventory",
    "sierra.reconciliation_invariant",
    "sierra.portfolio",
  ]);
});

test("workflow-alignment diagnosis remains read-only", () => {
  const plan = deterministicToolPlan("Diagnose alignment across Sierra intake, underwriting, and submission workflow.");
  assert.ok(plan.length >= 4);
  assert.equal(plan.some((step) => /repair|update|reconcile_deal|refresh_pipeline/.test(step.tool)), false);
});

test("broad productivity commands cannot silently become no-action turns", () => {
  const plan = deterministicToolPlan("Work through everything pending in our entire Sierra system, prioritize it, and make sure the submission process is functioning and operating as designed.");
  assert.deepEqual(plan.map((step) => step.tool), [
    "system.reconciliation_execute_bounded",
    "sierra.health",
    "sierra.infrastructure",
    "sierra.apply_inventory",
    "sierra.reconciliation_invariant",
    "sierra.portfolio",
  ]);
  assert.equal(plan[0].args.scope,"broad_sierra_execution");
  assert.equal(plan.some(step=>step.tool==="approvals.prepare_plan"),false);
});

test("deal-specific continuation bypasses the generic workflow summary",()=>{
  const prompt="Continue this same investigation. Do not repeat completed checks. Resolve the missing reconciliation evidence, inspect worker and queue status, and trace Mr Muffins specifically through intake → documents → canonical application → CapitalMatch → underwriting → submission.";
  const plan=deterministicToolPlan(prompt);
  assert.deepEqual(plan,[{tool:"sierra.continue_diagnostic_investigation",args:{reference:"Mr Muffins",scope:"deal_continuation",freshnessMs:300000}}]);
});
