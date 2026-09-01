import test from "node:test";
import assert from "node:assert/strict";
import { buildUniversalClosingStrategy, inferBuyerState, normalizeProductIntelligence } from "../src/universal-closer.js";
import { buildClosingBrief } from "../src/master-closer.js";
import fs from "node:fs";

const product = {
  productId: "advisory-1",
  name: "Growth Advisory",
  family: "consulting",
  version: "2026-09",
  evidenceRefs: ["catalog:advisory-1:2026-09"],
  outcomes: ["A documented growth plan"],
  proof: ["Verified customer case study"],
  packages: [{ id: "core" }, { id: "executive" }]
};

test("product intelligence fails closed when identity or evidence is missing", () => {
  assert.equal(normalizeProductIntelligence({ name: "Mystery" }).status, "incomplete");
  assert.equal(normalizeProductIntelligence(product).status, "verified");
});

test("buyer reasoning tracks emotion and decision state without claiming certainty", () => {
  const state = inferBuyerState({ conversation: [{ text: "I am frustrated and I need the numbers before my partner agrees." }] });
  assert.equal(state.emotionalTrack.emotion.value, "frustrated");
  assert.equal(state.decisionTrack.authority.value, "additional_stakeholder");
  assert.ok(state.emotionalTrack.emotion.confidence < 1);
  assert.match(state.inferencePolicy, /hypothesis/i);
});

test("universal strategy chooses the highest material discovery gap", () => {
  const strategy = buildUniversalClosingStrategy({ product, conversation: [{ text: "Tell me more." }], buyer: {} });
  assert.equal(strategy.fit, "potential_fit");
  assert.equal(strategy.discovery.gaps[0], "desired_outcome");
  assert.match(strategy.discovery.nextBestQuestion, /outcome/i);
  assert.equal(strategy.execution.bindingCommitmentAllowed, false);
});

test("ready analytical buyer receives a logical state-selected close", () => {
  const strategy = buildUniversalClosingStrategy({
    product,
    conversation: [{ text: "The ROI works. I am ready to start." }],
    buyer: { primaryGoal: "grow", problem: "stalled pipeline", timeline: "now", authority: "decision_maker", constraints: "budget verified", readiness: "high", communicationStyle: "analytical" },
    verifiedFacts: ["Budget documented"]
  });
  assert.equal(strategy.discovery.gaps.length, 0);
  assert.equal(strategy.responsePlan.close.type, "next_step_close");
  assert.equal(strategy.execution.externalSendAllowed, true);
});

test("poor fit disqualifies respectfully and blocks outreach", () => {
  const strategy = buildUniversalClosingStrategy({ product: { ...product, disqualifiers: ["outside service area"] }, deal: { disqualificationReason: "Outside service area" }, buyer: { primaryGoal: "help", problem: "x", timeline: "now", authority: "yes", constraints: "none" } });
  assert.equal(strategy.responsePlan.close.type, "respectful_disqualification");
  assert.equal(strategy.execution.externalSendAllowed, false);
});

test("master closing brief exposes universal reasoning alongside legacy financing controls", () => {
  const brief = buildClosingBrief({ reference: "sale-42", transactionType: "sales", product, prospect: { primaryGoal: "grow", problem: "stalled", timeline: "Q4", authority: "decision_maker", constraints: "budget" }, verifiedFacts: ["Product catalog verified"] });
  assert.equal(brief.contract, "georgie.master-closer.v3");
  assert.equal(brief.universalStrategy.contract, "georgie.universal-master-closer.v1");
  assert.equal(brief.universalStrategy.product.productId, "advisory-1");
});

test("production conversation prompt and capability manifest expose the universal closer charter", () => {
  const prompt = fs.readFileSync(new URL("../src/georgie.js", import.meta.url), "utf8");
  const manifest = fs.readFileSync(new URL("../src/capability-manifest.js", import.meta.url), "utf8");
  assert.match(prompt, /UNIVERSAL MASTER CLOSER CHARTER/);
  assert.match(prompt, /Reason on two tracks each turn/);
  assert.match(prompt, /Never use coercion/);
  assert.match(manifest, /verified_product_intelligence/);
  assert.match(manifest, /dual_track_buyer_reasoning/);
});
