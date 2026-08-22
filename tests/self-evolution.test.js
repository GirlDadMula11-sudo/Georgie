import test from "node:test";
import assert from "node:assert/strict";
import { buildEvolutionProposals } from "../src/self-evolution.js";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { runStaticBenchmark } from "../src/intelligence-benchmark.js";

test("self evolution converts measured weaknesses into bounded experiments", () => {
  const proposals = buildEvolutionProposals({ completionRate: 0.8, actionSuccessRate: 0.7, highImpactReviewRequired: 2, outcomeFeedback: { usefulnessRate: 0.6 }, latency: { firstResponseP95Ms: 5000 } }, { failed: ["research"] });
  assert.equal(proposals[0].area, "completion_reliability");
  assert.ok(proposals.some((item) => item.area === "evidence_grounding"));
  assert.ok(proposals.every((item) => item.productionChanged === false));
  assert.ok(proposals.every((item) => item.authority === "evaluation_only"));
});

test("self evolution routes deterministically without granting code mutation", () => {
  assert.deepEqual(deterministicToolPlan("Make Georgie self evolving using deep research"), [{ tool: "system.self_evolution_check", args: {} }]);
});

test("self evolution benchmark is covered", () => {
  const benchmark = runStaticBenchmark();
  const scenario = benchmark.cases.find((item) => item.id === "self_evolution");
  assert.equal(scenario?.passed, true);
  assert.equal(benchmark.failed.includes("self_evolution"), false);
});
