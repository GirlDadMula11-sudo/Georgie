import test from "node:test";
import assert from "node:assert/strict";
import { completeTurnV2 } from "../src/v2-turn-engine.js";

test("runtime certification bypasses heavyweight objective hydration", async () => {
  const started = Date.now();
  const result = await completeTurnV2({
    userId: "phase3-fast-path-test",
    sessionId: "runtime-certification",
    input: "Certify Georgie Phase 2. Inspect the canonical runtime registry, core and specialist execution planes, and live pressure budgets.",
    history: [],
    shouldFinalize: () => false
  });

  assert.equal(result.engine, "unified-georgie-runtime-v1-local-inspection");
  assert.equal(result.model, "deterministic-runtime-status");
  assert.equal(result.terminalState, "verified");
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].tool, "system.status");
  assert.equal(result.evidence[0].source, "system.status");
  assert.match(result.text, /Registry: valid/);
  assert.ok(Date.now() - started < 1000, "local runtime inspection must remain sub-second");
});

