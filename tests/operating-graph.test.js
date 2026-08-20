import test from "node:test";
import assert from "node:assert/strict";
import { continuationRecordForTurn, deriveContinuity } from "../src/operating-graph.js";

test("continuity ranks urgent unfinished objectives and preserves next actions", () => {
  const result = deriveContinuity([
    { id: "normal", title: "Normal", domain: "general", priority: "normal", status: "active", nextAction: "Continue normal work", updatedAt: "2026-08-20T20:00:00Z" },
    { id: "urgent", title: "Urgent", domain: "sierra", priority: "urgent", status: "blocked", nextAction: "Resolve verified blocker", approvalId: "approval-1", updatedAt: "2026-08-20T19:00:00Z" },
    { id: "done", title: "Done", priority: "urgent", status: "verified", nextAction: "Must not return", updatedAt: "2026-08-20T21:00:00Z" },
  ], []);
  assert.deepEqual(result.activeNodes.map((item) => item.id), ["urgent", "normal"]);
  assert.equal(result.nextActions[0].nextAction, "Resolve verified blocker");
  assert.equal(result.nextActions[0].approvalId, "approval-1");
  assert.equal(result.counts.blocked, 1);
});

test("continuity recovers only unfinished durable Mac jobs", () => {
  const result = deriveContinuity([], [
    { id: "queued", action: "developer.search", status: "queued", createdAt: "2026-08-20T20:00:00Z" },
    { id: "claimed", action: "developer.repo_inspect", status: "claimed", createdAt: "2026-08-20T20:01:00Z" },
    { id: "done", action: "app.open", status: "completed", createdAt: "2026-08-20T20:02:00Z" },
  ]);
  assert.deepEqual(result.unfinishedJobs.map((item) => item.id), ["queued", "claimed"]);
  assert.ok(result.unfinishedJobs.every((item) => item.durable));
});

test("a pending developer turn automatically becomes resumable engineering work", () => {
  const record = continuationRecordForTurn("session-1", "Inspect the repository", {
    route: { domain: "technical" },
    outcome: { requiresFollowUp: true, requiresRecovery: false, actions: [{ tool: "developer.search" }], pendingJobIds: ["job-1"] },
  });
  assert.equal(record.kind, "engineering");
  assert.equal(record.status, "waiting");
  assert.ok(record.evidenceRefs.includes("job:job-1"));
  assert.match(record.nextAction, /Recheck the durable job status/);
});

test("sensitive enrollment text is never copied into the continuity graph", () => {
  const record = continuationRecordForTurn("session-2", "Create enrollment code SECRET-123", {
    route: { domain: "technical" },
    outcome: { requiresFollowUp: true, requiresRecovery: false, actions: [{ tool: "system.create_enrollment_code" }], pendingJobIds: [] },
  });
  assert.equal(record.title, "Resume protected device enrollment work");
  assert.doesNotMatch(JSON.stringify(record), /SECRET-123/);
});
