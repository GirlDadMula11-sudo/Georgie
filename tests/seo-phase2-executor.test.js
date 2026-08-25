import test from "node:test";
import assert from "node:assert/strict";
import { buildSeoPhase2Objective, assertSeoPhase2ExecutionReceipt, phase2PlanFingerprint } from "../src/seo-phase2-executor.js";
import { compilePreservedSeoPhase2Command, SEO_PHASE2_COMMAND_SEQUENCE } from "../src/seo-phase2-batches.js";

const completedBefore = index => SEO_PHASE2_COMMAND_SEQUENCE.slice(0, index).map(item => item.commandId);

test("each preserved command compiles to its own durable objective instead of link-integrity collapse", () => {
  const objectives = SEO_PHASE2_COMMAND_SEQUENCE.map((item, index) => buildSeoPhase2Objective({ commandId: item.commandId, completedCommandIds: completedBefore(index) }));
  assert.equal(new Set(objectives.map(item => item.stableKey)).size, 6);
  assert.deepEqual(objectives.map(item => item.phase2.batch), SEO_PHASE2_COMMAND_SEQUENCE.map(item => item.batch));
  for (const objective of objectives) {
    assert.deepEqual(objective.steps.map(step => step.id), ["capture-before-state", "execute-bounded-batch", "capture-after-state"]);
    assert.equal(objective.steps[1].verification.expect.verified, true);
    assert.equal(objective.steps[1].verification.expect.planHash, objective.phase2.planHash);
    assert.notEqual(objective.steps[1].tool, "seo.wordpress_link_integrity_repair");
  }
});

test("later barriers fail closed until their exact predecessor is verified", () => {
  const second = SEO_PHASE2_COMMAND_SEQUENCE[1];
  assert.throws(() => buildSeoPhase2Objective({ commandId: second.commandId, completedCommandIds: [] }), /SEO_PHASE2_PREDECESSOR_NOT_VERIFIED/);
  assert.doesNotThrow(() => buildSeoPhase2Objective({ commandId: second.commandId, completedCommandIds: [SEO_PHASE2_COMMAND_SEQUENCE[0].commandId] }));
});

test("receipt gate rejects transport-only, unverifiable, or plan-drifted completion", () => {
  const commandId = SEO_PHASE2_COMMAND_SEQUENCE[0].commandId;
  const plan = compilePreservedSeoPhase2Command({ commandId });
  const planHash = phase2PlanFingerprint(plan);
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ commandId, batch: plan.batch, planHash: "wrong", verified: true }), /PLAN_HASH_MISMATCH/);
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ commandId, batch: plan.batch, planHash, verified: false }), /SEMANTIC_VERIFICATION/);
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ commandId, batch: plan.batch, planHash, verified: true }), /BEFORE_STATE/);
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ commandId, batch: plan.batch, planHash, verified: true, beforeStateCaptured: true, rollbackMaterialCreated: true }), /PUBLIC_READBACK/);
});

test("fully evidenced receipt passes and duplicate replay may not mutate", () => {
  const commandId = SEO_PHASE2_COMMAND_SEQUENCE[0].commandId;
  const plan = compilePreservedSeoPhase2Command({ commandId });
  const planHash = phase2PlanFingerprint(plan);
  const receipt = { commandId, batch: plan.batch, planHash, verified: true, beforeStateCaptured: true, rollbackMaterialCreated: true, publicReadbackVerified: true, mutationPerformed: true };
  assert.equal(assertSeoPhase2ExecutionReceipt(receipt).accepted, true);
  assert.throws(() => assertSeoPhase2ExecutionReceipt({ ...receipt, duplicateReplay: true }), /DUPLICATE_REPLAY_MUTATED/);
  assert.equal(assertSeoPhase2ExecutionReceipt({ ...receipt, duplicateReplay: true, mutationPerformed: false }).accepted, true);
});


test("transport remains nonterminal until the durable semantic objective verifies", async () => {
  const fs = await import("node:fs");
  const installer = fs.readFileSync(new URL("../scripts/install-seo-phase2-executor.mjs", import.meta.url), "utf8");
  const worker = fs.readFileSync(new URL("../src/objective-worker.js", import.meta.url), "utf8");
  assert.match(installer, /SEO_PHASE2_TRANSPORT_REOPEN/);
  assert.match(installer, /current\.status==="verified"/);
  assert.match(installer, /terminalState:"in_progress",completed:false/);
  assert.match(installer, /phase2Reopened=await reopenPhase2TransportIfNeeded/);
  assert.match(worker, /o\.stableKey === stableKey && o\.status !== "cancelled"/);
});
