import test from "node:test";
import assert from "node:assert/strict";
import { verifiedDirectResponse } from "../src/v2-turn-engine.js";

test("Phase 2 renders runtime status without a model call", () => {
  const response = verifiedDirectResponse("Certify Georgie Phase 2", [{
    ok: true,
    tool: "system.status",
    result: {
      sessionRuntime: { runtimeAuthority: {
        valid: true, componentCount: 19, objectiveLifecycleKernel: "objective-worker",
        coreFirstStartup: true, specialistFailureIsolation: true, specialistStartDelayMs: 1500,
        sourceMutationDuringStartup: false, emergencyNeoBackfillInNormalStartup: false,
        executionPlanes: { core: Array(15).fill("core"), specialist: Array(4).fill("specialist") }
      }},
      resourceGovernor: { specialistBudget: { maxEventLoopUtilization: 0.85, retryMs: 5000, deferrals: {} }},
      connections: { durableOperationalState: { healthy: true, pendingWrites: 0, providerCircuitOpen: false }}
    }
  }]);
  assert.equal(response.model, "deterministic-runtime-status");
  assert.equal(response.terminalState, "verified");
  assert.equal(response.completed, true);
  assert.match(response.text, /15 components/);
  assert.match(response.text, /4 components/);
  assert.match(response.text, /event-loop ceiling 85%/);
  assert.match(response.text, /pending writes 0/);
  assert.equal(response.route.reasoningEffort, "none");
});
