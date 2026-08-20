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
