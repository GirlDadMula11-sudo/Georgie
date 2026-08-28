import test from "node:test";
import assert from "node:assert/strict";
import { intelligenceRoute } from "../src/intelligence-gateway.js";
import { runIntelligenceEscalation } from "../src/intelligence-escalation.js";

test("Luna is always the first model attempt", async () => {
  const route = intelligenceRoute("classify this Sierra CRM application");
  const called = [];
  const value = await runIntelligenceEscalation({ route, execute: async step => { called.push(step.tier); return { text: "classified" }; } });
  assert.deepEqual(called, ["fast"]);
  assert.equal(value.selected.model, "gpt-5.6-luna");
});

test("ordinary Sierra judgment escalates Luna to Terra and stops", async () => {
  const route = intelligenceRoute("evaluate this Sierra CRM exception", { uncertainty: 0.5 });
  const called = [];
  const value = await runIntelligenceEscalation({ route, execute: async step => { called.push(step.tier); return { text: "evaluated" }; } });
  assert.deepEqual(called, ["fast", "balanced"]);
  assert.equal(value.selected.model, "gpt-5.6-terra");
});

test("material conflicting work escalates Luna to Terra to Sol", async () => {
  const route = intelligenceRoute("resolve conflicting lender underwriting evidence", { uncertainty: 0.9 });
  const called = [];
  const value = await runIntelligenceEscalation({ route, execute: async step => { called.push(step.tier); return { text: "resolved" }; } });
  assert.deepEqual(called, ["fast", "balanced", "frontier"]);
  assert.equal(value.selected.model, "gpt-5.6-sol");
});

test("a failed Luna quality gate advances to Terra", async () => {
  const route = intelligenceRoute("summarize this note");
  const called = [];
  const value = await runIntelligenceEscalation({
    route,
    execute: async step => { called.push(step.tier); return { text: "answer", qualityPassed: step.tier !== "fast" }; }
  });
  assert.deepEqual(called, ["fast", "balanced"]);
  assert.equal(value.selected.tier, "balanced");
});
