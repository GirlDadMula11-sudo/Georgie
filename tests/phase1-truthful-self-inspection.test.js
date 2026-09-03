import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { getCapabilityManifest } from "../src/capability-manifest.js";

test("Georgie runtime self-inspection remains local and truthful", () => {
  const prompt = "Inspect Georgie's currently deployed canonical runtime registry, startup authority, objective lifecycle kernel, source mutation, emergency NEO work, durable NEO backoff, idempotency, and degraded dependencies. Do not access Sierra.";
  const plan = deterministicToolPlan(prompt);
  assert.deepEqual(plan, [{ tool: "system.status", args: { scope: "runtime_authority" } }]);
  assert.equal(plan.some(action => String(action.tool).startsWith("sierra.")), false);

  const source = fs.readFileSync(new URL("../src/governed-connector.js", import.meta.url), "utf8");
  assert.match(source, /failedActions=Array\.isArray\(result\?\.actions\)/);
  assert.match(source, /\|\|failedActions/);

  const authority = getCapabilityManifest().sessionRuntime.runtimeAuthority;
  assert.equal(authority.valid, true);
  assert.equal(authority.componentCount, 20);
  assert.equal(authority.objectiveLifecycleKernel, "objective-worker");
  assert.equal(authority.objectiveKernelCount, 1);
  assert.equal(authority.sourceMutationDuringStartup, false);
  assert.equal(authority.emergencyNeoBackfillInNormalStartup, false);
  assert.equal(authority.durableNeoBackoffEnabled, true);
});
