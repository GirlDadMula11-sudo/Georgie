import test from "node:test";
import assert from "node:assert/strict";
import { specialistExecutionPermit } from "../src/resource-governor.js";

test("Phase 2 defers specialists under event-loop pressure", () => {
  const result = specialistExecutionPermit("test-pressure", { utilization: 0.99 });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "event_loop_pressure");
  assert.ok(result.retryAfterMs >= 1000);
});

test("Phase 2 permits specialists when core is uncongested", () => {
  const result = specialistExecutionPermit("test-clear", { utilization: 0.01 });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
  assert.equal(result.retryAfterMs, 0);
});
