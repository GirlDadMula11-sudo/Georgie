import test from "node:test";
import assert from "node:assert/strict";
import { eventIdempotencyKey, phase2Foundation, readinessDecision, transitionAllowed } from "../src/phase2-foundation.js";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("complex Phase 2 inspection decomposes into independent evidence reads", () => {
  const tools = deterministicToolPlan("Inspect GitHub, Vercel, and Render deployment health and repository structure. Identify broken build paths, missing monitors, and design Phase 2 event schema, state machine, idempotency, readiness rules, alerts, and regression tests.").map((item) => item.tool);
  assert.deepEqual(tools, ["system.github", "system.vercel", "system.render", "developer.repo_inspect", "system.phase2_foundation"]);
});
test("event identity is stable and tenant scoped", () => { assert.equal(eventIdempotencyKey({tenantId:"sierra",aggregateType:"deal",aggregateId:"42",eventType:"documents.ready",sourceEventId:"evt-1"}), "sierra:deal:42:documents.ready:evt-1"); });
test("readiness enforces Sierra statement and contradiction rules", () => {
  assert.equal(readinessDecision({identityVerified:true,applicationAuthorized:true,state:"NY",consecutiveStatementMonths:3}).ready, false);
  assert.equal(readinessDecision({identityVerified:true,applicationAuthorized:true,state:"NY",consecutiveStatementMonths:4}).ready, true);
  assert.equal(readinessDecision({identityVerified:true,applicationAuthorized:true,state:"FL",consecutiveStatementMonths:3,contradictionsUnresolved:true}).state, "blocked");
});
test("state machine rejects skips and terminal rewrites", () => { assert.equal(transitionAllowed("documents_ready", "underwriting"), true); assert.equal(transitionAllowed("received", "submitted"), false); assert.equal(transitionAllowed("funded", "underwriting"), false); });
test("foundation remains design-only and requires completion proof", () => { const value = phase2Foundation(); assert.equal(value.status, "design_ready_not_deployed"); assert.ok(value.crmSync.completionProof.includes("non_duplication")); assert.ok(value.regressionMatrix.includes("kill_switch")); });
