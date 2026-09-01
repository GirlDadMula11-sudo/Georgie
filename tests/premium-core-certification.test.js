import test from "node:test";
import assert from "node:assert/strict";
import { certifyPremiumCore, objectiveAnchorMatches, premiumCoreCertificationPlan, premiumObjectiveAnchor, PREMIUM_CORE_STANDARD } from "../src/premium-core-certification.js";

function passingRow(index, scenarioClass) {
  return {
    objectiveId: `objective-${index}`,
    scenarioClass,
    scenarioPassed: true,
    completedClaimed: true,
    completionVerified: true,
    consequentialActionExecutions: index % 5 === 0 ? 1 : 0,
    objectiveAnchorMatch: true,
    authorityValid: true,
    crossDomainLeak: false,
    ambiguousWrite: index % 7 === 0,
    ambiguousWriteReconciled: true,
    receiptReadbackVerified: true,
    checkpointRequired: index % 3 === 0,
    checkpointRecovered: true,
    recoveryRequired: index % 4 === 0,
    recoverySucceeded: true,
    manualResumeRequired: false,
    foregroundLatencyMs: 1200 + index,
    terminalState: "verified",
    receiptId: `receipt-${index}`,
    evidenceRefs: [`evidence-${index}`]
  };
}

function passingSuite() {
  return Array.from({ length: 100 }, (_, index) => passingRow(index, PREMIUM_CORE_STANDARD.requiredScenarioClasses[index % PREMIUM_CORE_STANDARD.requiredScenarioClasses.length]));
}

test("premium objective anchor is stable and detects drift", () => {
  const objective = { objectiveId: "o-1", intent: "Reconcile the account", constraints: ["no writes", "verified evidence"], authority: { mode: "read" }, acceptanceCriteria: ["receipt"] };
  const a = premiumObjectiveAnchor(objective), b = premiumObjectiveAnchor({ ...objective, constraints: [...objective.constraints].reverse() });
  assert.equal(a.digest, b.digest);
  assert.equal(objectiveAnchorMatches(a.digest, b.digest).matches, true);
  assert.equal(objectiveAnchorMatches(a.digest, { ...objective, intent: "Change the account" }).matches, false);
});

test("one hundred covered adversarial objectives can certify", () => {
  const result = certifyPremiumCore(passingSuite(), { measuredAt: "2026-09-01T00:00:00.000Z" });
  assert.equal(result.certified, true);
  assert.equal(result.status, "premium_core_certified");
  assert.equal(result.marketingClaimAllowed, true);
  assert.equal(result.metrics.receiptReadbackRate, 1);
  assert.equal(result.blockers.length, 0);
});

test("false completion, duplicate write, drift, and authority violation fail closed", () => {
  const rows = passingSuite();
  rows[3] = { ...rows[3], completionVerified: false };
  rows[4] = { ...rows[4], consequentialActionExecutions: 2 };
  rows[5] = { ...rows[5], objectiveAnchorMatch: false };
  rows[6] = { ...rows[6], authorityValid: false };
  const result = certifyPremiumCore(rows);
  assert.equal(result.certified, false);
  assert.equal(result.marketingClaimAllowed, false);
  assert.equal(result.metrics.falseCompletions, 1);
  assert.equal(result.metrics.duplicateConsequentialActions, 1);
  assert.equal(result.metrics.objectiveDriftEvents, 1);
  assert.equal(result.metrics.authorityViolations, 1);
});

test("missing adversarial scenario coverage cannot certify", () => {
  const rows = Array.from({ length: 100 }, (_, index) => passingRow(index, "ordinary_turn"));
  const result = certifyPremiumCore(rows);
  assert.equal(result.certified, false);
  assert.ok(result.blockers.some(value => value.startsWith("missing_scenario:")));
});

test("certification plan never equates source presence with premium readiness", () => {
  const plan = premiumCoreCertificationPlan();
  assert.equal(plan.state, "available_not_certified");
  assert.match(plan.rule, /do not certify/i);
  assert.equal(plan.promotionOrder.at(-1), "premium_market_claim");
});
