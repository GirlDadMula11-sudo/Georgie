import test from "node:test";
import assert from "node:assert/strict";
import { buildOutcomeLifecycle, enhanceOutcomeResponse, outcomeInstruction } from "../src/outcome-lifecycle.js";

test("verified actions permit a completion claim", () => {
  const outcome = buildOutcomeLifecycle([{ tool: "example.read", ok: true, result: { status: "completed" } }]);
  assert.equal(outcome.state, "verified");
  assert.equal(outcome.completionClaimAllowed, true);
  assert.equal(outcome.counts.verified, 1);
});

test("durable pending work can never be presented as completed", () => {
  const outcome = buildOutcomeLifecycle([{ tool: "developer.search", ok: true, result: { status: "pending", durable: true, jobId: "job-1" } }]);
  assert.equal(outcome.state, "pending");
  assert.equal(outcome.completionClaimAllowed, false);
  assert.deepEqual(outcome.pendingJobIds, ["job-1"]);
  assert.match(outcomeInstruction(outcome), /Never describe.*completed/i);
});

test("mixed success and failure requires recovery and forbids completion", () => {
  const outcome = buildOutcomeLifecycle([
    { tool: "one", ok: true, result: { status: "completed" } },
    { tool: "two", ok: false, error: "provider unavailable" },
  ]);
  assert.equal(outcome.state, "partial_failed");
  assert.equal(outcome.requiresRecovery, true);
  assert.equal(outcome.completionClaimAllowed, false);
});

test("unknown tool evidence remains explicitly unverified", () => {
  const outcome = buildOutcomeLifecycle([{ tool: "unknown" }]);
  assert.equal(outcome.state, "unverified");
  assert.equal(outcome.requiresFollowUp, true);
  assert.equal(outcome.completionClaimAllowed, false);
});

test("the enhancement preserves every existing response field", () => {
  const original = {
    text: "Existing Georgie response",
    model: "existing-model",
    engine: "existing-engine",
    remembered: 4,
    customCapability: { preserved: true },
    actions: [],
  };
  const enhanced = enhanceOutcomeResponse(original);
  assert.equal(enhanced.text, original.text);
  assert.equal(enhanced.model, original.model);
  assert.equal(enhanced.engine, original.engine);
  assert.equal(enhanced.remembered, original.remembered);
  assert.deepEqual(enhanced.customCapability, original.customCapability);
  assert.equal(enhanced.outcome.state, "no_action");
});
