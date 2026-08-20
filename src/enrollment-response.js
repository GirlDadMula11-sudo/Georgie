export function verifiedEnrollmentResponse(input, toolResults = []) {
  const text = String(input || "").toLowerCase();
  const requested = /\b(?:create|generate|get|give|issue|need|show)\b/.test(text)
    && /\b(?:one[- ]time\s+)?enrollment code\b/.test(text);
  const enrollment = toolResults.find((result) => result?.tool === "system.create_enrollment_code");
  if (!requested || !enrollment) return null;

  const base = {
    responseId: null,
    webSearches: 0,
    model: "deterministic-verified-action",
    route: { domain: "technical", tier: "fast", reasoningEffort: "low", latencyClass: "instant" },
  };
  if (!enrollment.ok) {
    return { ...base, text: `I could not create the enrollment code: ${enrollment.error || "the secure enrollment store rejected the request"}. No valid code was issued.` };
  }
  const code = String(enrollment.result?.code || "").trim();
  if (!code) return { ...base, text: "The enrollment action returned without a verifiable code. No code should be treated as valid." };
  const expiresAt = enrollment.result?.expiresAt;
  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" })
    : "15 minutes";
  return {
    ...base,
    sensitiveResponse: true,
    text: `Your one-time Mac enrollment code is:\n\n${code}\n\nEnter it immediately. It expires at ${expiry} and can be used only once.`,
  };
}
