import test from "node:test";
import assert from "node:assert/strict";
import { buildSeoPhase2Objective, assertSeoPhase2ExecutionReceipt } from "../src/seo-phase2-executor.js";
import { SEO_PHASE2_COMMAND_SEQUENCE } from "../src/seo-phase2-batches.js";

test("each preserved command compiles to its own durable objective instead of link-integrity collapse", () => {
  const objectives = SEO_PHASE2_COMMAND_SEQUENCE.map(item => buildSeoPhase2Objective({ commandId: item.commandId }));
  assert.equal(new Set(objectives.map(item => item.stableKey)).size, 6);
  assert.deepEqual(objectives.map(item => item.phase2.batch), SEO_PHASE2_COMMAND_SEQUENCE.map(item => item.batch));
  for (const objective of objectives) {
    assert.deepEqual(objective.steps.map(step => step.id), ["capture-before-state", "execute-bounded-batch", "capture-after-state"]);
    assert.equal(objective.steps[1].verification.expect.verified, true);
    assert.notEqual(objective.steps[1].tool, "seo.wordpress_link_integrity_repair");
  }
});

test("receipt gate rejects transport-only or unverifiable completion", () => {
  const commandId = SEO_PHASE2_COMMAND_SEQUENCE[0].commandId;
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ commandId, batch: "homepage_positioning_and_onpage_integrity", verified: false }), /SEMANTIC_VERIFICATION/);
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ commandId, batch: "homepage_positioning_and_onpage_integrity", verified: true }), /BEFORE_STATE/);
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ commandId, batch: "homepage_positioning_and_onpage_integrity", verified: true, beforeStateCaptured: true, rollbackMaterialCreated: true }), /PUBLIC_READBACK/);
});

test("fully evidenced receipt passes and duplicate replay may not mutate", () => {
  const commandId = SEO_PHASE2_COMMAND_SEQUENCE[0].commandId;
  const receipt = { commandId, batch: "homepage_positioning_and_onpage_integrity", verified: true, beforeStateCaptured: true, rollbackMaterialCreated: true, publicReadbackVerified: true, mutationPerformed: true };
  assert.equal(assertSeoPhase2ExecutionReceipt(receipt).accepted, true);
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ ...receipt, duplicateReplay: true }), /DUPLICATE_REPLAY_MUTATED/);
  assert.equal(assertSeoPhase2ExecutionReceipt({ ...receipt, duplicateReplay: true, mutationPerformed: false }).accepted, true);
});
