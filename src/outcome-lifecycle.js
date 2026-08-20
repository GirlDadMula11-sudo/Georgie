const TERMINAL = new Set(["verified", "failed", "blocked", "cancelled"]);

function normalizedStatus(item = {}) {
  if (item.ok === false) return "failed";
  const status = String(item.result?.status || item.status || "").toLowerCase();
  if (["pending", "queued", "running", "accepted", "in_progress"].includes(status)) return "pending";
  if (["failed", "error", "cancelled", "blocked"].includes(status)) return status === "error" ? "failed" : status;
  if (item.ok === true) return "verified";
  return "unverified";
}

export function buildOutcomeLifecycle(toolResults = []) {
  const actions = (Array.isArray(toolResults) ? toolResults : []).map((item, index) => ({
    index,
    tool: String(item?.tool || item?.name || `tool_${index + 1}`),
    status: normalizedStatus(item),
    jobId: item?.result?.jobId || item?.jobId || null,
    durable: Boolean(item?.result?.durable || item?.durable),
    error: item?.ok === false ? String(item?.error || "Tool execution failed") : null,
  }));
  const pending = actions.filter((item) => item.status === "pending");
  const failed = actions.filter((item) => ["failed", "blocked", "cancelled"].includes(item.status));
  const verified = actions.filter((item) => item.status === "verified");
  const unverified = actions.filter((item) => item.status === "unverified");
  let state = "no_action";
  if (actions.length && verified.length === actions.length) state = "verified";
  else if (pending.length) state = verified.length || failed.length ? "partial_pending" : "pending";
  else if (failed.length) state = verified.length ? "partial_failed" : "failed";
  else if (unverified.length) state = "unverified";
  return {
    state,
    terminal: state === "no_action" || TERMINAL.has(state),
    completionClaimAllowed: state === "no_action" || state === "verified",
    counts: { total: actions.length, verified: verified.length, pending: pending.length, failed: failed.length, unverified: unverified.length },
    actions,
    pendingJobIds: pending.map((item) => item.jobId).filter(Boolean),
    requiresRecovery: failed.length > 0,
    requiresFollowUp: pending.length > 0 || unverified.length > 0,
  };
}

export function outcomeInstruction(outcome) {
  if (!outcome || outcome.state === "no_action") return "No tool execution occurred; do not imply that an external action was performed.";
  if (outcome.completionClaimAllowed) return "All requested tool actions returned verified terminal outcomes. Report only what the evidence proves.";
  if (outcome.state.includes("pending")) return "Some accepted work is still pending. Report verified partial results and job identifiers. Never describe the overall request as completed.";
  if (outcome.state.includes("failed")) return "At least one action failed. Report the verified successes separately, name the failure, and provide the bounded recovery path. Never claim overall completion.";
  return "Tool evidence is incomplete. State the uncertainty precisely and do not claim completion.";
}

export function enhanceOutcomeResponse(response = {}) {
  const outcome = buildOutcomeLifecycle(response.actions || []);
  return {
    ...response,
    outcome,
    completed: response.completed === false ? false : outcome.completionClaimAllowed,
    terminalReason: response.terminalReason || outcome.state,
  };
}
