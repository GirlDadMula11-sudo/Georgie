import test from "node:test";
import assert from "node:assert/strict";
import { classifyRenderLogs } from "../src/integrations/provider-observability.js";

const labels = (instance, level = "info") => [
  { name: "resource", value: "srv-georgie" },
  { name: "instance", value: instance },
  { name: "level", value: level },
  { name: "type", value: "app" }
];

test("old-instance npm SIGTERM during a successful rollout is lifecycle noise, not a runtime fault", () => {
  const result = classifyRenderLogs([
    { timestamp: "2026-08-22T02:06:54Z", labels: labels("new-instance"), message: "Georgie listening on port 10000" },
    { timestamp: "2026-08-22T02:08:01Z", labels: labels("old-instance", "error"), message: "npm error path /app" },
    { timestamp: "2026-08-22T02:08:01Z", labels: labels("old-instance", "error"), message: "npm error command failed" },
    { timestamp: "2026-08-22T02:08:01Z", labels: labels("old-instance", "error"), message: "npm error signal SIGTERM" },
    { timestamp: "2026-08-22T02:08:01Z", labels: labels("old-instance", "error"), message: "npm error command sh -c node src/server.js" }
  ]);
  assert.equal(result.activeInstance, "new-instance");
  assert.equal(result.runtimeErrors.length, 0);
  assert.equal(result.lifecycleEvents.length, 4);
  assert.ok(result.lifecycleEvents.every((event) => event.classification === "rollout_shutdown"));
});

test("an error on the active instance remains a runtime fault", () => {
  const result = classifyRenderLogs([
    { timestamp: "2026-08-22T02:06:54Z", labels: labels("active"), message: "Georgie listening on port 10000" },
    { timestamp: "2026-08-22T02:09:00Z", labels: labels("active", "error"), message: "Unhandled database connection error" }
  ]);
  assert.equal(result.runtimeErrors.length, 1);
  assert.equal(result.lifecycleEvents.length, 0);
});
