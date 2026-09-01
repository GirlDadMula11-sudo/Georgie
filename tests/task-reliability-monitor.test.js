import test from "node:test";
import assert from "node:assert/strict";
import { objectiveReliabilityReport, TASK_RELIABILITY_STANDARD } from "../src/task-reliability-monitor.js";

const verified = (id, recoveryTrail = []) => ({ id, stableKey: id, status: "verified", steps: [{ id: "s1" }], evidence: [{ stepId: "s1", state: "verified" }], recoveryTrail, updatedAt: "2026-09-01T00:00:00.000Z" });

test("task reliability report proves completions and recovery without hiding failures", () => {
  const report = objectiveReliabilityReport([
    verified("clean"),
    verified("recovered", [{ attempt: 1, failureClass: "transient" }]),
    { id: "blocked", stableKey: "blocked", status: "blocked", checkpoint: { lastError: "invalid input", lastFailureClass: "precondition" } }
  ], { at: Date.parse("2026-09-01T00:10:00.000Z") });
  assert.equal(report.metrics.verified, 2);
  assert.equal(report.metrics.blocked, 1);
  assert.equal(report.metrics.recoverySuccessRate, 1);
  assert.equal(report.alerts.some(alert => alert.code === "BLOCKED_OBJECTIVES"), true);
  assert.equal(report.standard.contract, TASK_RELIABILITY_STANDARD.contract);
});

test("task reliability report raises critical false-completion and authority alarms", () => {
  const report = objectiveReliabilityReport([{
    id: "unsafe", stableKey: "unsafe", status: "verified", steps: [{ id: "s1" }], evidence: [],
    integrity: { authorityViolation: true, duplicateConsequentialAction: true }, updatedAt: "2026-09-01T00:00:00.000Z"
  }], { at: Date.parse("2026-09-01T00:01:00.000Z") });
  assert.equal(report.standardsPassing, false);
  assert.equal(report.metrics.falseCompletionCount, 1);
  assert.equal(report.metrics.authorityViolationCount, 1);
  assert.equal(report.metrics.duplicateConsequentialActionCount, 1);
  assert.equal(report.alerts.filter(alert => alert.severity === "critical").length, 3);
});

test("expired leases become visible as stalled objectives", () => {
  const report = objectiveReliabilityReport([{
    id: "stalled", stableKey: "stalled", status: "running", stepIndex: 0,
    lease: { until: "2026-09-01T00:00:30.000Z" }, updatedAt: "2026-09-01T00:00:00.000Z"
  }], { at: Date.parse("2026-09-01T00:20:00.000Z") });
  assert.equal(report.metrics.stalled, 1);
  assert.equal(report.alerts[0].code, "STALLED_OBJECTIVES");
});
