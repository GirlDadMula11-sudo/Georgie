import test from "node:test";
import assert from "node:assert/strict";
import { buildConcessionLadder, buildNegotiationPlan, nextBestNegotiationQuestion, transactionPlaybook } from "../src/closing-playbooks.js";
import { buildClosingBrief, closingOutcomeLearningRecord } from "../src/master-closer.js";

test("supports transaction-specific commercial playbooks", () => {
  assert.equal(transactionPlaybook("sales").type, "sales");
  assert.equal(transactionPlaybook("procurement").type, "procurement");
  assert.equal(transactionPlaybook("nonsense").type, "general");
});

test("generic negotiation plan requires evidence before leverage", () => {
  const plan = buildNegotiationPlan({ transactionType: "vendor", verifiedFacts: [], counterparty: {} });
  assert.equal(plan.evidenceState, "discovery_required");
  assert.deepEqual(plan.leverageSources, []);
  assert.equal(plan.authority.bindingCommitmentAllowed, false);
});

test("conditional concession ladder never authorizes beyond verified authority", () => {
  const ladder = buildConcessionLadder({ items: [{ give: "longer term", get: "lower price", verified: true }], authorityVerified: false });
  assert.equal(ladder.canExecuteBindingConcession, false);
  assert.match(ladder.rule, /Never concede unconditionally/);
});

test("master closer builds generic sales brief from verified facts", () => {
  const brief = buildClosingBrief({
    reference: "sale-1",
    transactionType: "sales",
    merchant: { primaryGoal: "close annual software subscription" },
    verifiedFacts: ["Customer requires implementation by October 1", "Approved budget is documented"],
    conversation: [{ text: "I need to think about it" }],
    lender: { role: "buyer", authorityVerified: false, bindingAuthority: false }
  });
  assert.equal(brief.transactionType, "sales");
  assert.equal(brief.state, "closing_brief_ready");
  assert.equal(brief.objection.type, "think_about_it");
  assert.match(brief.nextBestAction.nextQuestion, /specifically/i);
  assert.equal(brief.nextBestAction.bindingActionAllowed, false);
});

test("verified learning supports non-financing terminal outcomes", () => {
  const brief = buildClosingBrief({ reference: "renewal-1", transactionType: "renewal", verifiedFacts: ["Renewal quote verified"] });
  const record = closingOutcomeLearningRecord({ brief, outcome: { status: "renewed", counterparty: "Customer A" }, evidenceRefs: ["ev-renewal"] });
  assert.equal(record.transactionType, "renewal");
  assert.equal(record.status, "renewed");
  assert.equal(record.synthetic, false);
});

test("objection questions are specific and non-deceptive", () => {
  assert.match(nextBestNegotiationQuestion({ objectionType: "competitor_offer" }), /verified term/i);
  assert.match(nextBestNegotiationQuestion({ objectionType: "trust" }), /proof|transparency/i);
});
