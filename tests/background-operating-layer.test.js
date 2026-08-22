import test from "node:test";
import assert from "node:assert/strict";
import { notificationWindow } from "../src/background-operating-layer.js";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("Phase 1 approval activates the durable background operating layer", () => {
  assert.deepEqual(deterministicToolPlan("Approved Phase 1"), [{ tool: "system.background_operations_activate", args: {} }]);
});

test("quiet hours suppress routine notices but preserve the daily schedule boundary", () => {
  const quiet = notificationWindow(new Date("2026-08-22T03:00:00Z"));
  assert.equal(quiet.quiet, true);
  const brief = notificationWindow(new Date("2026-08-22T12:00:00Z"));
  assert.equal(brief.hour, 8);
  assert.equal(brief.dailyBriefDue, true);
  assert.equal(brief.quiet, false);
});
