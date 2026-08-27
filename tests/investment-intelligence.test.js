import test from "node:test";
import assert from "node:assert/strict";
import { intelligenceRoute } from "../src/intelligence-gateway.js";
import { selectDomainPacks } from "../src/domain-packs.js";
import { runtimePolicy } from "../src/runtime-policy.js";
import { investmentCapabilityContract, investmentRuntimePrompt, isInvestmentIntent } from "../src/investment-intelligence.js";

test("detects cross-asset investment language without contaminating ordinary turns", () => {
  assert.equal(isInvestmentIntent("Analyze Bitcoin tokenomics and custody risk"), true);
  assert.equal(isInvestmentIntent("Compare two dividend stocks and Treasury bonds"), true);
  assert.equal(isInvestmentIntent("Plan a family trip"), false);
});

test("routes investment work to an explicitly enabled frontier, current-evidence path", () => {
  const previous = process.env.GEORGIE_FRONTIER_INFERENCE_ENABLED;
  process.env.GEORGIE_FRONTIER_INFERENCE_ENABLED = "true";
  try {
    const route = intelligenceRoute("Research the latest Ethereum price and investment risks");
    assert.equal(route.domain, "investments");
    assert.equal(route.requestedTier, "frontier");
    assert.equal(route.tier, "frontier");
    assert.equal(route.costPolicy.frontierEnabled, true);
    assert.equal(route.requiresCurrentEvidence, true);
    assert.equal(runtimePolicy("Check the latest Bitcoin price").allowWebTool, true);
  } finally {
    if (previous == null) delete process.env.GEORGIE_FRONTIER_INFERENCE_ENABLED;
    else process.env.GEORGIE_FRONTIER_INFERENCE_ENABLED = previous;
  }
});

test("activates a dedicated domain pack", () => {
  const ids = selectDomainPacks("Stress test my stock and crypto portfolio").map((pack) => pack.id);
  assert.deepEqual(ids, ["universal", "investments"]);
});

test("investment prompt requires provenance, uncertainty, downside analysis, and transaction approval", () => {
  const prompt = investmentRuntimePrompt("Should I buy this crypto token?");
  assert.match(prompt, /source and as-of time/i);
  assert.match(prompt, /bull case, base case, bear case/i);
  assert.match(prompt, /explicit transaction-specific approval/i);
  assert.match(prompt, /Never autonomously trade or custody/i);
});

test("capability contract permits deep analysis but never autonomous trading or custody", () => {
  const contract = investmentCapabilityContract();
  assert.equal(contract.schema, "georgie.investment-intelligence.v1");
  assert.equal(contract.autonomousTrading, false);
  assert.equal(contract.autonomousCustody, false);
  assert.equal(contract.transactionApproval.required, true);
  assert.ok(contract.analysis.includes("on_chain"));
  assert.ok(contract.analysis.includes("portfolio_exposure"));
});
