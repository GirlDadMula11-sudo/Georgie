import test from "node:test";
import assert from "node:assert/strict";
import { scheduleRuntimePlane, startRuntimeProfile, validateRuntimeRegistry } from "../src/runtime-components.js";

const kernel = start => ({ id: "objective-worker", profiles: ["web"], role: "kernel", authority: "objective-lifecycle", plane: "core", start });
const specialist = start => ({ id: "specialist-test", profiles: ["web"], role: "executor", authority: "specialist-test", plane: "specialist", start });

test("Phase 2 isolates specialist startup failure from Georgie core", () => {
  const events = [];
  const components = [kernel(() => events.push("core")), specialist(() => { throw new Error("dependency unavailable"); })];
  const warnings = [];
  const result = startRuntimeProfile("web", { components, logger: { log() {}, warn(message) { warnings.push(message); } } });
  assert.deepEqual(result.started, ["objective-worker"]);
  assert.deepEqual(result.degraded, [{ id: "specialist-test", error: "dependency unavailable" }]);
  assert.equal(result.kernel, "objective-worker");
  assert.deepEqual(events, ["core"]);
  assert.match(warnings[0], /specialist isolated/);
});

test("Phase 2 keeps core startup failure fail-closed", () => {
  const components = [kernel(() => { throw new Error("kernel unavailable"); }), specialist(() => {})];
  assert.throws(() => startRuntimeProfile("web", { components, logger: { log() {}, warn() {} } }), /Core runtime component failed: objective-worker/);
});

test("Phase 2 forbids specialist objective kernels", () => {
  const invalid = [{ ...kernel(() => {}), plane: "specialist" }];
  const result = validateRuntimeRegistry(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("specialist-kernel:objective-worker"));
});

test("Phase 2 schedules specialists only after core startup", () => {
  const events = [];
  const components = [kernel(() => events.push("core")), specialist(() => events.push("specialist"))];
  const logger = { log(message) { events.push(message); }, warn() {} };
  startRuntimeProfile("web", { components, plane: "core", logger });
  let deferred = null;
  const scheduled = scheduleRuntimePlane("web", "specialist", {
    components, delayMs: 1500, logger,
    schedule(fn, delay) { deferred = { fn, delay }; return { unref() {} }; }
  });
  assert.equal(scheduled.delayMs, 1500);
  assert.equal(deferred.delay, 1500);
  assert.equal(events.includes("specialist"), false);
  deferred.fn();
  assert.equal(events.includes("specialist"), true);
});
