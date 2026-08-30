import test from "node:test";
import assert from "node:assert/strict";
import { intelligenceRoute } from "../src/intelligence-gateway.js";

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key]; else process.env[key] = value;
  }
  try { return fn(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("high-impact language begins with Luna but requires Sol authority", () => {
  withEnv({ GEORGIE_FRONTIER_INFERENCE_ENABLED: null, GEORGIE_BALANCED_INFERENCE_ENABLED: null }, () => {
    const route = intelligenceRoute("repair the production database incident");
    assert.equal(route.requestedTier, "frontier");
    assert.equal(route.tier, "fast");
    assert.deepEqual(route.escalationPlan.map(step => step.tier), ["frontier"]);
    assert.equal(route.costPolicy.expensiveTierOptInRequired, false);
  });
});

test("frontier inference is available unless its emergency kill switch is off", () => {
  withEnv({ GEORGIE_FRONTIER_INFERENCE_ENABLED: "false" }, () => {
    const route = intelligenceRoute("repair the production database incident");
    assert.deepEqual(route.escalationPlan.map(step => step.tier), []);
    assert.equal(route.costPolicy.frontierEnabled, false);
    assert.equal(route.conclusionAuthority, "triage_and_evidence_only");
  });
});

test("routine Sierra processing requests Luna when no higher tier is necessary", () => {
  withEnv({ GEORGIE_FRONTIER_INFERENCE_ENABLED: null, GEORGIE_BALANCED_INFERENCE_ENABLED: "true" }, () => {
    const route = intelligenceRoute("classify and route this Sierra CRM application");
    assert.equal(route.requestedTier, "fast");
    assert.equal(route.model, "gpt-5.6-luna");
    assert.equal(route.costPolicy.spendClass, "low");
    assert.equal(route.conclusionAuthority, "full");
  });
});

test("ordinary Sierra judgment requests Terra", () => {
  withEnv({ GEORGIE_FRONTIER_INFERENCE_ENABLED: null, GEORGIE_BALANCED_INFERENCE_ENABLED: "true" }, () => {
    const route = intelligenceRoute("evaluate this Sierra CRM exception", { risk: "normal", uncertainty: 0.5 });
    assert.equal(route.requestedTier, "balanced");
    assert.equal(route.tier, "fast");
    assert.equal(route.model, "gpt-5.6-luna");
    assert.equal(route.escalationPlan[1].model, "gpt-5.6-terra");
  });
});

test("high-impact work starts as triage until the ladder reaches its minimum tier", () => {
  withEnv({ GEORGIE_FRONTIER_INFERENCE_ENABLED: null, GEORGIE_BALANCED_INFERENCE_ENABLED: null }, () => {
    const route = intelligenceRoute("resolve conflicting lender underwriting evidence", { uncertainty: 0.9 });
    assert.equal(route.requestedTier, "frontier");
    assert.equal(route.tier, "fast");
    assert.equal(route.meetsMinimumTier, false);
    assert.equal(route.conclusionAuthority, "triage_and_evidence_only");
    assert.equal(route.costPolicy.unsafeDowngradePrevented, true);
  });
});

test("fresh sufficient evidence avoids a model call", () => {
  const route = intelligenceRoute("check the CRM status", {
    cachedEvidenceAvailable: true,
    cacheFresh: true,
    evidenceCoverage: 1,
    requiredEvidenceCoverage: 0.9
  });
  assert.equal(route.shouldInvokeModel, false);
  assert.equal(route.selectedSource, "cached_evidence");
  assert.equal(route.costPolicy.spendClass, "zero");
});
