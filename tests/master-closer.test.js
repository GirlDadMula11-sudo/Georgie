import test from "node:test";
import assert from "node:assert/strict";
import { buildClosingBrief, classifyClosingObjection, closingOutcomeLearningRecord, normalizeVerifiedOffer } from "../src/master-closer.js";

test("classifies common closing objections", () => {
  assert.equal(classifyClosingObjection("The daily payment is too high").type, "payment");
  assert.equal(classifyClosingObjection("I have a better offer from another lender").type, "competitor_offer");
  assert.equal(classifyClosingObjection("Let's move forward and sign").type, "ready_to_close");
});

test("unverified offers cannot be ranked as leverage", () => {
  const brief = buildClosingBrief({
    reference: "deal-1",
    merchant: { primaryGoal: "working capital" },
    offers: [{ offerId: "o1", lender: "Lender A", amount: 100000, verified: false }],
    conversation: [{ text: "Can you do better on the payment?" }]
  });
  assert.equal(brief.verifiedOfferCount, 0);
  assert.equal(brief.bestOffer, null);
  assert.equal(brief.state, "offer_verification_required");
});

test("verified offers produce ranked closing brief without binding authority", () => {
  const brief = buildClosingBrief({
    reference: "deal-2",
    merchant: { primaryGoal: "lowest payment", targets: { amount: 100000, maxPayment: 5000, minTermMonths: 12 }, priorities: { payment: 5, term: 3, amount: 2 } },
    offers: [
      { offerId: "a", lender: "Alpha", amount: 100000, payment: 4500, termMonths: 12, totalPayback: 125000, verified: true, evidenceRefs: ["ev-a"] },
      { offerId: "b", lender: "Beta", amount: 95000, payment: 5200, termMonths: 10, totalPayback: 120000, verified: true, evidenceRefs: ["ev-b"] }
    ],
    conversation: [{ text: "The payment is my biggest concern" }]
  });
  assert.equal(brief.state, "closing_brief_ready");
  assert.equal(brief.bestOffer.offerId, "a");
  assert.equal(brief.objection.type, "payment");
  assert.equal(brief.nextBestAction.bindingActionAllowed, false);
  assert.equal(brief.nextBestAction.approvalRequired, true);
  assert.equal(brief.executionQuality.target, 0.99);
});

test("offer verification requires evidence lineage", () => {
  assert.equal(normalizeVerifiedOffer({ verified: true, evidenceRefs: [], amount: 100000 }).verified, false);
  assert.equal(normalizeVerifiedOffer({ verified: true, evidenceRefs: ["ev-1"], amount: 100000 }).verified, true);
});

test("learning rejects synthetic or unevidenced terminal outcomes", () => {
  const brief = buildClosingBrief({ reference: "deal-3", offers: [] });
  assert.throws(() => closingOutcomeLearningRecord({ brief, outcome: { status: "funded" }, evidenceRefs: [] }), /Verified outcome evidence is required/);
  assert.throws(() => closingOutcomeLearningRecord({ brief, outcome: { status: "approved" }, evidenceRefs: ["ev"] }), /terminal status/);
  const record = closingOutcomeLearningRecord({ brief, outcome: { status: "funded", lender: "Alpha" }, evidenceRefs: ["ev-funded"] });
  assert.equal(record.synthetic, false);
  assert.equal(record.status, "funded");
});
