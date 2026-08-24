const clean = value => String(value || "").trim();

const NEGATIONS = /\b(?:do\s+not|don't|dont|not\s+approved|deny|denied|reject|rejected|cancel|stop|hold\s+off|wait)\b/i;
const QUESTION_ONLY = /^(?:can|could|would|should|will)\s+you\b/i;
const APPROVAL_INTENT = [
  /\b(?:i\s+)?approve(?:d|\s+this|\s+that|\s+it|\s+the\s+(?:plan|repair|package))?\b/i,
  /\byou\s+have\s+my\s+approval\b/i,
  /\bgo\s+ahead\b/i,
  /\bmove\s+forward\b/i,
  /\bproceed\b/i,
  /\bapply\s+(?:it|that|the\s+(?:repair|patch|package|plan))\b/i,
  /\bexecute\s+(?:it|that|the\s+(?:repair|patch|package|plan))\b/i,
  /\bdo\s+it\b/i,
  /\bcomplete\s+it\b/i,
  /\bfinish\s+it\b/i
];

export function classifyApprovalIntent(input) {
  const text = clean(input);
  if (!text) return { intent: "none", confidence: 0, text };
  if (NEGATIONS.test(text)) return { intent: "deny_or_pause", confidence: 0.99, text };
  if (QUESTION_ONLY.test(text) && !/\bapprove|approval\b/i.test(text)) return { intent: "none", confidence: 0.9, text };
  const matched = APPROVAL_INTENT.find(pattern => pattern.test(text));
  if (!matched) return { intent: "none", confidence: 0.8, text };
  const explicit = /\bapprove|approval\b/i.test(text);
  return { intent: "approve", confidence: explicit ? 0.99 : 0.94, text };
}

export function isExplicitConversationalApproval(input) {
  return classifyApprovalIntent(input).intent === "approve";
}
