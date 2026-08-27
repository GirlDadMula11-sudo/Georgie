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

test("high-impact language cannot silently escalate to frontier inference", () => {
  withEnv({ GEORGIE_FRONTIER_INFERENCE_ENABLED: null, GEORGIE_BALANCED_INFERENCE_ENABLED: null }, () => {
    const route = intelligenceRoute("repair the production database incident");
    assert.equal(route.requestedTier, "frontier");
    assert.equal(route.tier, "fast");
    assert.equal(route.costPolicy.downgradedForCost, true);
    assert.equal(route.costPolicy.expensiveTierOptInRequired, true);
  });
});

test("frontier inference requires explicit operator opt-in", () => {
  withEnv({ GEORGIE_FRONTIER_INFERENCE_ENABLED: "true" }, () => {
    const route = intelligenceRoute("repair the production database incident");
    assert.equal(route.tier, "frontier");
    assert.equal(route.costPolicy.frontierEnabled, true);
  });
});
