import { runtimePolicy } from "./runtime-policy.js";

const HIGH_IMPACT = /\b(production|deploy|database|underwriting|capitalmatch|lender|funding|financial|legal|security|credential|customer|client|incident|outage|repair|rollback)\b/i;
const SIERRA = /\b(sierra|deal|application|document|underwriting|capitalmatch|lender|submission|funding|crm|worker|queue|deployment|database)\b/i;
const PERSONAL = /\b(personal|family|household|daughter|travel|purchase|bill|credit|bank|subscription)\b/i;
const TECHNICAL = /\b(repo|repository|codebase|source code|git|software|programming|developer|debug|api|architecture)\b/i;
const INVESTMENTS = /\b(stock(?:s)?|equity|equities|crypto(?:currency)?|bitcoin|ethereum|token|etf|bond|treasury|commodity|forex|option(?:s)?|portfolio|brokerage|dividend|earnings|valuation|investment|investing|trade|trading)\b/i;

function enabled(name) {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

export function intelligenceRoute(input = "") {
  const text = String(input || "").trim();
  const policy = runtimePolicy(text);
  const highImpact = HIGH_IMPACT.test(text);
  const domain = SIERRA.test(text) ? "sierra" : INVESTMENTS.test(text) ? "investments" : PERSONAL.test(text) ? "personal" : TECHNICAL.test(text) ? "technical" : "general";

  // Cost fence: expensive tiers are opt-in, never automatic. A keyword such as
  // "production" or "repair" must not silently escalate spend. Until an operator
  // explicitly enables a tier in runtime configuration, Georgie stays on the fast
  // model and uses deterministic/tool evidence for control-plane work.
  const requestedTier = policy.reasoningEffort === "high" || highImpact ? "frontier" : policy.reasoningEffort === "medium" ? "balanced" : "fast";
  const frontierEnabled = enabled("GEORGIE_FRONTIER_INFERENCE_ENABLED");
  const balancedEnabled = enabled("GEORGIE_BALANCED_INFERENCE_ENABLED") || frontierEnabled;
  const tier = requestedTier === "frontier"
    ? (frontierEnabled ? "frontier" : balancedEnabled ? "balanced" : "fast")
    : requestedTier === "balanced"
      ? (balancedEnabled ? "balanced" : "fast")
      : "fast";

  const model = tier === "frontier"
    ? process.env.OPENAI_MODEL || "gpt-5.6-sol"
    : tier === "balanced"
      ? process.env.OPENAI_BALANCED_MODEL || "gpt-5.6-terra"
      : process.env.OPENAI_FAST_MODEL || "gpt-5.6-luna";

  return {
    version: "2026-08-27.1-cost-fence",
    domain,
    tier,
    requestedTier,
    model,
    reasoningEffort: tier === "frontier" ? "high" : tier === "balanced" ? policy.reasoningEffort : "low",
    responseVerbosity: policy.responseVerbosity,
    requiresCurrentEvidence: highImpact || policy.allowWebTool,
    highImpact,
    allowWebTool: policy.allowWebTool,
    latencyClass: policy.latencyClass,
    costPolicy: {
      hierarchy: ["deterministic", "cached_evidence", "fast_model", "balanced_model", "frontier_model"],
      selectedTier: tier,
      requestedTier,
      expensiveTierOptInRequired: true,
      frontierEnabled,
      balancedEnabled,
      frontierJustification: tier === "frontier" ? (highImpact ? "high_impact_and_operator_enabled" : "deep_reasoning_and_operator_enabled") : null,
      downgradeAllowed: true,
      downgradedForCost: tier !== requestedTier
    }
  };
}
