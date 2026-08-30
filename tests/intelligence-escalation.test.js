import test from "node:test";
import assert from "node:assert/strict";
import { intelligenceRoute } from "../src/intelligence-gateway.js";
import { runIntelligenceEscalation } from "../src/intelligence-escalation.js";

test("Luna is always the first model attempt", async () => {
  const route = intelligenceRoute("classify this Sierra CRM application");
  const called = [];
  const value = await runIntelligenceEscalation({ route, execute: async step => { called.push(step.tier); return { text: "The application was classified and routed successfully." }; } });
  assert.deepEqual(called, ["fast"]);
  assert.equal(value.selected.model, "gpt-5.6-luna");
});

test("ordinary Sierra judgment escalates Luna to Terra and stops", async () => {
  const route = intelligenceRoute("evaluate this Sierra CRM exception", { uncertainty: 0.5 });
  const called = [];
  const value = await runIntelligenceEscalation({ route, execute: async step => { called.push(step.tier); return { text: "The Sierra exception was evaluated with sufficient operational evidence." }; } });
  assert.deepEqual(called, ["fast", "balanced"]);
  assert.equal(value.selected.model, "gpt-5.6-terra");
});

test("material conflicting work goes directly to Sol without wasteful lower-tier calls", async () => {
  const route = intelligenceRoute("resolve conflicting lender underwriting evidence", { uncertainty: 0.9 });
  const called = [];
  const value = await runIntelligenceEscalation({ route, execute: async step => { called.push(step.tier); return { text: "The conflicting underwriting evidence was resolved with material-decision authority." }; } });
  assert.deepEqual(called, ["frontier"]);
  assert.equal(value.selected.model, "gpt-5.6-sol");
});

test("a failed deterministic quality gate blocks rather than spending above the required tier", async () => {
  const route = intelligenceRoute("summarize this note");
  const called = [];
  await assert.rejects(runIntelligenceEscalation({
    route,
    execute: async step => { called.push(step.tier); return { text: "short" }; }
  }),/No available intelligence tier/);
  assert.deepEqual(called, ["fast"]);
});
