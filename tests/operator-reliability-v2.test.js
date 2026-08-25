import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, recoveryDecision, memoryReliability, scoreMemoryCandidate, preflightPlan, reliabilityReceipt } from "../src/operator-reliability-v2.js";

test("failure classification separates transient, governance, verification and precondition failures", () => {
  assert.equal(classifyFailure("503 temporary upstream unavailable"), "transient");
  assert.equal(classifyFailure("approval required"), "governance");
  assert.equal(classifyFailure("verification not satisfied"), "verification");
  assert.equal(classifyFailure("unsupported operation"), "precondition");
});

test("recovery is step-scoped and preserves the original objective", () => {
  const first = recoveryDecision({ stepId: "send", attemptsByStep: {}, maxAttempts: 3, error: "timeout", at: 0 });
  assert.equal(first.status, "recovering");
  assert.equal(first.attempts, 1);
  const second = recoveryDecision({ stepId: "send", attemptsByStep: { send: 1 }, maxAttempts: 3, error: "timeout", at: 1000 });
  assert.equal(second.attempts, 2);
  assert.equal(second.exhausted, false);
  const other = recoveryDecision({ stepId: "verify", attemptsByStep: { send: 2 }, maxAttempts: 3, error: "verification not satisfied", at: 2000 });
  assert.equal(other.attempts, 1);
});

test("verified provider evidence outranks conversational inference", () => {
  const verified = { text: "JP Import funded 100k", sourceType: "provider_receipt", confidence: 0.99, status: "verified", importance: 0.9, updatedAt: new Date().toISOString() };
  const inference = { text: "JP Import funded 100k", sourceType: "inference", confidence: 0.6, status: "active", importance: 0.9, updatedAt: new Date().toISOString() };
  assert.ok(memoryReliability(verified) > memoryReliability(inference));
  assert.ok(scoreMemoryCandidate(verified, "JP Import funded") > scoreMemoryCandidate(inference, "JP Import funded"));
});

test("write plans fail preflight without verification or explicit approval flag", () => {
  const result = preflightPlan([{ id: "submit", tool: "lender.submit", policy: "external_side_effect" }], ["lender.submit"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(item => item.code).sort(), ["APPROVAL_FLAG_REQUIRED", "VERIFICATION_REQUIRED"]);
});

test("terminal completion receipt requires verified evidence for all steps", () => {
  const objective = { id: "obj-1", stableKey: "sierra-1", steps: [{ id: "a" }, { id: "b" }] };
  assert.equal(reliabilityReceipt({ objective, terminalStatus: "verified", evidence: [{ state: "verified" }] }).complete, false);
  assert.equal(reliabilityReceipt({ objective, terminalStatus: "verified", evidence: [{ state: "verified" }, { state: "verified" }] }).complete, true);
});
