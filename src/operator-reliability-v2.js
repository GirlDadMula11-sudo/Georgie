const now = () => new Date().toISOString();

export function classifyFailure(error = "") {
  const text = String(error || "").toLowerCase();
  if (/approval|required|authorization|forbidden|permission|policy/.test(text)) return "governance";
  if (/timeout|timed out|network|connection|econn|429|502|503|504|temporary|unavailable/.test(text)) return "transient";
  if (/unsupported|not allowlisted|schema|validation|missing|required|mismatch|invalid/.test(text)) return "precondition";
  if (/verification|readback|proof|receipt|not satisfied/.test(text)) return "verification";
  return "unknown";
}

export function recoveryDecision({ stepId, attemptsByStep = {}, maxAttempts = 8, error, approvalRequired = false, at = Date.now() } = {}) {
  const current = Math.max(0, Number(attemptsByStep?.[stepId] || 0));
  const attempts = current + 1;
  const failureClass = approvalRequired ? "governance" : classifyFailure(error);
  const exhausted = attempts >= Math.max(1, Number(maxAttempts) || 8);
  const baseMs = failureClass === "transient" ? 3000 : failureClass === "verification" ? 10000 : 5000;
  const delayMs = Math.min(300000, baseMs * 2 ** Math.min(attempts - 1, 6));
  return {
    failureClass,
    attempts,
    exhausted,
    status: approvalRequired ? "waiting_approval" : exhausted ? "blocked" : "recovering",
    nextRunAt: approvalRequired ? null : new Date(Number(at) + delayMs).toISOString(),
    recoveryEvent: { at: new Date(Number(at)).toISOString(), stepId: String(stepId || "unknown"), failureClass, attempt: attempts, error: String(error || "execution_failed").slice(0, 1000) }
  };
}

export function resetStepAttempts(attemptsByStep = {}, stepId) {
  return { ...(attemptsByStep || {}), [String(stepId || "unknown")]: 0 };
}

export function memoryReliability(memory = {}) {
  const confidence = Math.max(0, Math.min(1, Number(memory.confidence ?? 0.7)));
  const sourceWeight = ({ provider_receipt: 1, system_readback: 0.98, verified_user: 0.95, user: 0.9, conversation: 0.75, inference: 0.45 })[String(memory.sourceType || memory.source || "conversation")] ?? 0.65;
  const statusWeight = memory.status === "superseded" || memory.status === "conflicted" ? 0.25 : memory.status === "verified" ? 1 : 0.8;
  return Number((confidence * sourceWeight * statusWeight).toFixed(4));
}

export function scoreMemoryCandidate(memory = {}, query = "", at = Date.now()) {
  const tokenize = value => new Set(String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(word => word.length > 2));
  const queryTokens = tokenize(query);
  const memoryTokens = tokenize(`${memory.text || ""} ${(memory.tags || []).join(" ")} ${memory.category || ""} ${memory.sourceRef || ""}`);
  let overlap = 0;
  for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;
  const timestamp = new Date(memory.observedAt || memory.updatedAt || memory.createdAt || 0).getTime();
  const ageDays = Number.isFinite(timestamp) ? Math.max(0, (Number(at) - timestamp) / 86400000) : 3650;
  const recency = 1 / (1 + ageDays / 45);
  const importance = Math.max(0, Math.min(1, Number(memory.importance ?? 0.5)));
  return overlap * 3 + importance * 2 + recency + memoryReliability(memory) * 3;
}

export function memoryContextLine(memory = {}) {
  const provenance = [memory.sourceType || memory.source || "conversation", memory.sourceRef || null, memory.observedAt || memory.updatedAt || memory.createdAt || null].filter(Boolean).join(" | ");
  const reliability = memoryReliability(memory);
  const status = memory.status || "active";
  return `- [${memory.category || "fact"}; ${status}; confidence=${Number(memory.confidence ?? 0.7).toFixed(2)}; reliability=${reliability}] ${memory.text || ""}${provenance ? ` (source: ${provenance})` : ""}`;
}

export function preflightPlan(steps = [], toolNames = []) {
  const available = new Set((toolNames || []).map(String));
  const errors = [];
  const seen = new Set();
  for (const [index, step] of (steps || []).entries()) {
    const id = String(step?.id || `step-${index + 1}`);
    if (seen.has(id)) errors.push({ code: "DUPLICATE_STEP_ID", stepId: id });
    seen.add(id);
    if (!step?.tool) errors.push({ code: "MISSING_TOOL", stepId: id });
    else if (available.size && !available.has(String(step.tool))) errors.push({ code: "UNKNOWN_TOOL", stepId: id, tool: String(step.tool) });
    if (["sensitive_write", "external_side_effect"].includes(step?.policy) && !step?.requiresApproval) errors.push({ code: "APPROVAL_FLAG_REQUIRED", stepId: id });
    if (step?.policy !== "read" && !step?.verification?.tool) errors.push({ code: "VERIFICATION_REQUIRED", stepId: id });
  }
  return { ok: errors.length === 0, errors, checkedAt: now(), stepCount: Array.isArray(steps) ? steps.length : 0 };
}

export function reliabilityReceipt({ objective, terminalStatus, evidence = [] } = {}) {
  const receipts = Array.isArray(evidence) ? evidence : [];
  const verifiedEvidence = receipts.filter(item => item?.state === "verified");
  const complete = terminalStatus === "verified" && verifiedEvidence.length >= Number(objective?.steps?.length || 0);
  return {
    objectiveId: objective?.id || null,
    stableKey: objective?.stableKey || null,
    terminalStatus: terminalStatus || objective?.status || null,
    verifiedStepCount: verifiedEvidence.length,
    expectedStepCount: Number(objective?.steps?.length || 0),
    complete,
    generatedAt: now()
  };
}
