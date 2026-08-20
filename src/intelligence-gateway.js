import { runtimePolicy } from "./runtime-policy.js";

const HIGH_IMPACT = /\b(production|deploy|database|underwriting|capitalmatch|lender|funding|financial|legal|security|credential|customer|client|incident|outage|repair|rollback)\b/i;
const SIERRA = /\b(sierra|deal|application|document|underwriting|capitalmatch|lender|submission|funding|crm|worker|queue|deployment|database)\b/i;
const PERSONAL = /\b(personal|family|household|daughter|travel|purchase|bill|credit|bank|subscription)\b/i;

export function intelligenceRoute(input = "") {
  const text = String(input || "").trim();
  const policy = runtimePolicy(text);
  const highImpact = HIGH_IMPACT.test(text);
  const domain = SIERRA.test(text) ? "sierra" : PERSONAL.test(text) ? "personal" : "general";
  const tier = policy.reasoningEffort === "high" || highImpact ? "frontier" : policy.reasoningEffort === "medium" ? "balanced" : "fast";
  const model = tier === "frontier"
    ? process.env.OPENAI_MODEL || "gpt-5.6-sol"
    : tier === "balanced"
      ? process.env.OPENAI_BALANCED_MODEL || "gpt-5.6-terra"
      : process.env.OPENAI_FAST_MODEL || "gpt-5.6-luna";
  return {
    version: "2026-08-20.1",
    domain,
    tier,
    model,
    reasoningEffort: tier === "frontier" ? "high" : policy.reasoningEffort,
    responseVerbosity: policy.responseVerbosity,
    requiresCurrentEvidence: highImpact || policy.allowWebTool,
    highImpact,
    allowWebTool: policy.allowWebTool,
    latencyClass: policy.latencyClass
  };
}
