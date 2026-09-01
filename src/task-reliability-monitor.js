const ACTIVE = new Set(["queued", "running", "waiting", "waiting_approval", "recovering"]);
const TERMINAL = new Set(["verified", "blocked", "cancelled"]);

const rate = (n, d) => d ? Number((n / d).toFixed(6)) : 0;
const age = (value, at) => value ? Math.max(0, at - new Date(value).getTime()) : null;

export const TASK_RELIABILITY_STANDARD = Object.freeze({
  contract: "georgie.task-reliability-standard.v1",
  verifiedCompletionRate: 1,
  falseCompletionCount: 0,
  duplicateConsequentialActionCount: 0,
  authorityViolationCount: 0,
  recoverySuccessRate: 0.99,
  maximumBlockedRate: 0.01,
  maximumStalledObjectives: 0
});

export function objectiveReliabilityReport(objectives = [], options = {}) {
  const rows = Array.isArray(objectives) ? objectives : [];
  const at = Number(options.at || Date.now());
  const stallAfterMs = Math.max(60_000, Number(options.stallAfterMs || 15 * 60_000));
  const verified = rows.filter(row => row?.status === "verified");
  const blocked = rows.filter(row => row?.status === "blocked");
  const active = rows.filter(row => ACTIVE.has(row?.status));
  const terminal = rows.filter(row => TERMINAL.has(row?.status));
  const recoveryEvents = rows.flatMap(row => Array.isArray(row?.recoveryTrail) ? row.recoveryTrail : []);
  const recoveredObjectives = rows.filter(row => row?.status === "verified" && (row?.recoveryTrail?.length || 0) > 0);
  const recoveryObjectives = rows.filter(row => (row?.recoveryTrail?.length || 0) > 0);
  const stalled = active.filter(row => {
    if (row.status === "waiting_approval") return false;
    const leaseExpired = row.lease?.until && new Date(row.lease.until).getTime() <= at;
    const overdue = row.nextRunAt && new Date(row.nextRunAt).getTime() <= at && age(row.updatedAt, at) >= stallAfterMs;
    return Boolean(leaseExpired || overdue);
  });
  const evidenceFailures = verified.filter(row => {
    const expected = Number(row?.steps?.length || 0);
    const observed = (row?.evidence || []).filter(item => item?.state === "verified").length;
    return observed < expected;
  });
  const metrics = {
    total: rows.length,
    active: active.length,
    verified: verified.length,
    blocked: blocked.length,
    waitingApproval: rows.filter(row => row?.status === "waiting_approval").length,
    recovering: rows.filter(row => row?.status === "recovering").length,
    stalled: stalled.length,
    recoveryEvents: recoveryEvents.length,
    verifiedCompletionRate: rate(verified.length, terminal.length),
    blockedRate: rate(blocked.length, terminal.length),
    recoverySuccessRate: recoveryObjectives.length ? rate(recoveredObjectives.length, recoveryObjectives.length) : 1,
    falseCompletionCount: evidenceFailures.length,
    duplicateConsequentialActionCount: rows.filter(row => row?.integrity?.duplicateConsequentialAction === true).length,
    authorityViolationCount: rows.filter(row => row?.integrity?.authorityViolation === true).length
  };
  const alerts = [];
  if (metrics.falseCompletionCount) alerts.push({ severity: "critical", code: "FALSE_COMPLETION", objectiveIds: evidenceFailures.map(row => row.id) });
  if (metrics.duplicateConsequentialActionCount) alerts.push({ severity: "critical", code: "DUPLICATE_CONSEQUENTIAL_ACTION" });
  if (metrics.authorityViolationCount) alerts.push({ severity: "critical", code: "AUTHORITY_VIOLATION" });
  if (stalled.length) alerts.push({ severity: "attention", code: "STALLED_OBJECTIVES", objectiveIds: stalled.map(row => row.id) });
  if (blocked.length) alerts.push({ severity: "attention", code: "BLOCKED_OBJECTIVES", objectiveIds: blocked.map(row => row.id) });
  return {
    contract: "georgie.task-reliability-report.v1",
    measuredAt: new Date(at).toISOString(),
    standard: TASK_RELIABILITY_STANDARD,
    metrics,
    standardsPassing: metrics.falseCompletionCount === 0 && metrics.duplicateConsequentialActionCount === 0 && metrics.authorityViolationCount === 0 && metrics.stalled === 0 && metrics.recoverySuccessRate >= TASK_RELIABILITY_STANDARD.recoverySuccessRate,
    alerts,
    stalledObjectives: stalled.map(row => ({ id: row.id, stableKey: row.stableKey, status: row.status, stepIndex: row.stepIndex, updatedAt: row.updatedAt, leaseUntil: row.lease?.until || null, nextRunAt: row.nextRunAt || null })),
    blockedObjectives: blocked.map(row => ({ id: row.id, stableKey: row.stableKey, lastError: row.checkpoint?.lastError || null, failureClass: row.checkpoint?.lastFailureClass || null, stepAttempt: row.checkpoint?.stepAttempt || null }))
  };
}
