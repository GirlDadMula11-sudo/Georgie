function text(v) { return String(v?.message || v || "").toLowerCase(); }

export function isTransientReplyCloserInfraError(error) {
  return /timeout|aborted|429|5\d\d|connection|econn|reset|fetch failed|socket|temporarily unavailable|too many connections/.test(text(error));
}

function receiptHasTransientError(receipts = []) {
  return Array.isArray(receipts) && receipts.some(row => row && /error|deferred/.test(String(row.status || "")) && isTransientReplyCloserInfraError(row.error || ""));
}

export function nextReplyCloserSchedule({ result = null, error = null, failures = 0, activeMs = 30_000, idleMs = 60_000, maxBackoffMs = 180_000 } = {}) {
  const boundedFailures = Math.max(0, Math.min(Number(failures) || 0, 8));
  const resultError = result?.ok === false ? result?.error : null;
  const transient = isTransientReplyCloserInfraError(error || resultError || "") || receiptHasTransientError(result?.receipts);
  if (transient) {
    const nextFailures = Math.min(8, boundedFailures + 1);
    return { delayMs: Math.min(maxBackoffMs, idleMs * (2 ** Math.min(nextFailures, 3))), failures: nextFailures, mode: "infra_backoff" };
  }
  const hasJobs = Array.isArray(result?.jobs) && result.jobs.length > 0;
  const hasReceiptWork = Array.isArray(result?.receipts) && result.receipts.some(row => row && !["waiting_receipt"].includes(String(row.status || "")));
  if (hasJobs || hasReceiptWork) return { delayMs: activeMs, failures: 0, mode: "active" };
  if (result?.ok === false) return { delayMs: activeMs, failures: 0, mode: "nontransient_error" };
  return { delayMs: idleMs, failures: 0, mode: "idle" };
}

export const replyCloserBackpressureContract = Object.freeze({
  adaptiveSelfScheduling: true,
  fixedIntervalPolling: false,
  transientFailureBackoff: true,
  idlePollRelaxation: true,
  activePollPreserved: true,
  maxBackoffBounded: true
});
