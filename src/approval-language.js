const clean = value => String(value || "").trim();

// Accept clear, affirmative authorization in ordinary language while requiring
// an approval verb. Scope is still supplied by the latest eligible bounded plan.
const APPROVAL_PATTERNS = [
  /^(?:yes[,.!]?\s*)?(?:so\s+)?(?:complete|proceed|execute|apply|finish|do)\s+(?:it|that|the plan|the repair)(?:\s+now)?[,.!;:\s-]*(?:you have|with|i give|this is)\s+(?:my\s+)?approval\b/i,
  /^(?:approved|i approve|you have my approval)(?:\s+(?:it|that|the plan|the repair))?[.!]?$/i,
  /^(?:yes[,.!]?\s*)?(?:you are|you're|youre)\s+approved\s+to\s+(?:fix|repair|complete|finish|execute|apply|do|proceed\s+with)\s+(?:it|that|the plan|the repair)(?:\s+now)?[.!]?$/i,
  /^(?:yes[,.!]?\s*)?i\s+(?:hereby\s+)?approve\s+(?:you\s+to\s+)?(?:fix|repair|complete|finish|execute|apply|do|proceed\s+with)\s+(?:it|that|the plan|the repair)(?:\s+now)?[.!]?$/i,
  /^(?:yes[,.!]?\s*)?(?:go ahead|move forward)\s+(?:and\s+)?(?:fix|repair|complete|finish|execute|apply|do)\s+(?:it|that|the plan|the repair)[,.!;:\s-]*(?:you are|you're|youre)\s+approved(?:\s+to\s+do\s+so)?[.!]?$/i
];

export function isExplicitConversationalApproval(input) {
  const text = clean(input);
  return text.length > 0 && APPROVAL_PATTERNS.some(pattern => pattern.test(text));
}
