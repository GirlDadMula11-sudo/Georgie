import { runtimePolicy } from "./runtime-policy.js";

const HIGH_IMPACT = /\b(production|deploy|database|underwriting|capitalmatch|lender|funding|financial|legal|security|credential|customer|client|incident|outage|repair|rollback)\b/i;
const SIERRA = /\b(sierra|deal|application|document|underwriting|capitalmatch|lender|submission|funding|crm|worker|queue|deployment|database)\b/i;
const PERSONAL = /\b(personal|family|household|daughter|travel|purchase|bill|credit|bank|subscription)\b/i;
const TECHNICAL = /\b(repo|repository|codebase|source code|git|software|programming|developer|debug|api|architecture)\b/i;
const INVESTMENTS = /\b(stock(?:s)?|equity|equities|crypto(?:currency)?|bitcoin|ethereum|token|etf|bond|treasury|commodity|forex|option(?:s)?|portfolio|brokerage|dividend|earnings|valuation|investment|investing|trade|trading)\b/i;
const ROUTINE_PROCESSING = /\b(classify|categorize|extract|normalize|deduplicate|route|triage|format|parse|tag|short summary|status lookup|field mapping)\b/i;
const CONFLICT_OR_UNCERTAINTY = /\b(conflict|contradiction|ambiguous|uncertain|exception|edge case|root cause|tradeoff|scenario|forecast|investigate|architecture|strategy)\b/i;
const CURRENT_EVIDENCE = /\b(current|latest|today|live|recent|verify|evidence|source|research|web|provider|database|crm)\b/i;

export const INTELLIGENCE_TIERS = Object.freeze({
  fast: Object.freeze({ source: "openai", modelFamily: "gpt-5.6-luna", spendClass: "low", role: "bounded_processor" }),
  balanced: Object.freeze({ source: "openai", modelFamily: "gpt-5.6-terra", spendClass: "standard", role: "operational_reasoner" }),
  frontier: Object.freeze({ source: "openai", modelFamily: "gpt-5.6-sol", spendClass: "premium", role: "complex_reasoner" })
});

function enabled(name, env = process.env) {
  return String(env[name] || "").trim().toLowerCase() === "true";
}

function bounded(value, fallback = 0.5) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function domainFor(text) {
  return SIERRA.test(text) ? "sierra" : INVESTMENTS.test(text) ? "investments" : PERSONAL.test(text) ? "personal" : TECHNICAL.test(text) ? "technical" : "general";
}

function minimumTier({ text, policy, highImpact, domain, context }) {
  const risk = String(context.risk || (highImpact ? "high" : "normal")).toLowerCase();
  const uncertainty = bounded(context.uncertainty, CONFLICT_OR_UNCERTAINTY.test(text) ? 0.8 : policy.reasoningEffort === "high" ? 0.7 : policy.reasoningEffort === "medium" ? 0.45 : 0.2);
  const impact = bounded(context.businessImpact, highImpact ? 0.9 : domain === "sierra" ? 0.6 : 0.35);
  const routine = context.routine === true || ROUTINE_PROCESSING.test(text);
  const requiresJudgment = context.requiresJudgment === true || CONFLICT_OR_UNCERTAINTY.test(text);
  const critical = ["critical", "material"].includes(risk) || (highImpact && (uncertainty >= 0.65 || requiresJudgment));

  if (routine && !critical && !context.minimumTier) return { tier: "fast", uncertainty, impact, routine, requiresJudgment };
  if (critical || context.minimumTier === "frontier" || policy.reasoningEffort === "high" && (uncertainty >= 0.65 || domain === "investments" || highImpact)) return { tier: "frontier", uncertainty, impact, routine, requiresJudgment };
  if (context.minimumTier === "balanced" || requiresJudgment || impact >= 0.55 || domain === "sierra") return { tier: "balanced", uncertainty, impact, routine, requiresJudgment };
  return { tier: "fast", uncertainty, impact, routine, requiresJudgment };
}

function admittedTier(requestedTier, env = process.env) {
  const frontierEnabled = enabled("GEORGIE_FRONTIER_INFERENCE_ENABLED", env);
  const balancedEnabled = enabled("GEORGIE_BALANCED_INFERENCE_ENABLED", env) || frontierEnabled;
  const tier = requestedTier === "frontier"
    ? (frontierEnabled ? "frontier" : balancedEnabled ? "balanced" : "fast")
    : requestedTier === "balanced"
      ? (balancedEnabled ? "balanced" : "fast")
      : "fast";
  return { tier, frontierEnabled, balancedEnabled };
}

function modelFor(tier, env = process.env) {
  if (tier === "frontier") return env.OPENAI_MODEL || "gpt-5.6-sol";
  if (tier === "balanced") return env.OPENAI_BALANCED_MODEL || env.OPENAI_ROUTER_MODEL || "gpt-5.6-terra";
  return env.OPENAI_FAST_MODEL || "gpt-5.6-luna";
}

/**
 * Shared Georgie/Sierra intelligence admission contract.
 * Sierra callers declare requirements in context; Georgie remains the sole
 * authority that selects a provider/model inside configured budgets.
 */
export function intelligenceRoute(input = "", context = {}, env = process.env) {
  const text = String(input || "").trim();
  const policy = runtimePolicy(text);
  const highImpact = context.highImpact === true || HIGH_IMPACT.test(text);
  const domain = context.domain || domainFor(text);
  const required = minimumTier({ text, policy, highImpact, domain, context });
  const admission = admittedTier(required.tier, env);
  const deterministicAvailable = context.deterministicAvailable === true;
  const cachedEvidenceAvailable = context.cachedEvidenceAvailable === true && context.cacheFresh !== false;
  const evidenceSufficient = bounded(context.evidenceCoverage, 0) >= bounded(context.requiredEvidenceCoverage, highImpact ? 0.95 : 0.85);
  const zeroSpendSource = deterministicAvailable ? "deterministic" : cachedEvidenceAvailable && evidenceSufficient ? "cached_evidence" : null;
  const order = ["fast", "balanced", "frontier"];
  const meetsMinimumTier = order.indexOf(admission.tier) >= order.indexOf(required.tier);
  const conclusionAuthority = zeroSpendSource ? "verified_evidence" : meetsMinimumTier ? "full" : highImpact ? "triage_and_evidence_only" : "bounded_with_disclosure";
  const requiresCurrentEvidence = highImpact || policy.allowWebTool || context.requiresCurrentEvidence === true || CURRENT_EVIDENCE.test(text);
  const selectedSource = zeroSpendSource || INTELLIGENCE_TIERS[admission.tier].modelFamily;
  const reasons = [
    zeroSpendSource ? `${zeroSpendSource}_satisfies_requirement` : null,
    required.routine ? "routine_high_volume_work" : null,
    required.requiresJudgment ? "judgment_or_conflicting_evidence" : null,
    highImpact ? "high_impact_domain" : null,
    requiresCurrentEvidence ? "current_evidence_required" : null,
    !meetsMinimumTier ? "minimum_model_tier_not_enabled" : null
  ].filter(Boolean);

  return {
    version: "2026-08-28.1-intelligence-governor",
    domain,
    tier: admission.tier,
    requestedTier: required.tier,
    minimumTier: required.tier,
    model: modelFor(admission.tier, env),
    selectedSource,
    shouldInvokeModel: !zeroSpendSource,
    conclusionAuthority,
    meetsMinimumTier,
    reasoningEffort: admission.tier === "frontier" ? "high" : admission.tier === "balanced" ? (policy.reasoningEffort === "low" ? "medium" : policy.reasoningEffort) : "low",
    responseVerbosity: policy.responseVerbosity,
    requiresCurrentEvidence,
    highImpact,
    allowWebTool: policy.allowWebTool || context.allowWebTool === true,
    latencyClass: policy.latencyClass,
    selectionEvidence: {
      uncertainty: required.uncertainty,
      businessImpact: required.impact,
      routine: required.routine,
      requiresJudgment: required.requiresJudgment,
      reasons
    },
    costPolicy: {
      hierarchy: ["deterministic", "cached_evidence", "local_model", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
      selectedTier: admission.tier,
      requestedTier: required.tier,
      minimumTier: required.tier,
      spendClass: zeroSpendSource ? "zero" : INTELLIGENCE_TIERS[admission.tier].spendClass,
      expensiveTierOptInRequired: true,
      frontierEnabled: admission.frontierEnabled,
      balancedEnabled: admission.balancedEnabled,
      frontierJustification: admission.tier === "frontier" ? (highImpact ? "high_impact_and_operator_enabled" : "complex_reasoning_and_operator_enabled") : null,
      downgradeAllowed: !highImpact,
      downgradedForCost: admission.tier !== required.tier,
      unsafeDowngradePrevented: highImpact && !meetsMinimumTier,
      conclusionAuthority
    }
  };
}
