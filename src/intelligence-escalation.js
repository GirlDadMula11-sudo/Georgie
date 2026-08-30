import { evaluateAttemptSufficiency } from "./intelligence-gateway.js";

export async function runIntelligenceEscalation({ route, execute, evaluate = evaluateAttemptSufficiency, onAssessment = null }) {
  if (!route?.shouldInvokeModel) return { result: null, attempts: [], zeroSpend: true };
  if (typeof execute !== "function") throw new TypeError("Intelligence escalation requires an execute function");

  const attempts = [];
  for (const step of route.escalationPlan || []) {
    try {
      const result = await execute(step);
      const assessment = evaluate(route, { ...result, tier: step.tier });
      if (typeof onAssessment === "function") await onAssessment({ step, result, assessment });
      attempts.push({ ...step, sufficient: assessment.sufficient, reason: assessment.reason });
      if (assessment.sufficient) return { result, attempts, selected: step, zeroSpend: false };
    } catch (error) {
      attempts.push({ ...step, sufficient: false, reason: "provider_or_runtime_failure", error: String(error instanceof Error ? error.message : error).slice(0, 300) });
    }
  }

  const error = new Error("No available intelligence tier satisfied the request");
  error.code = "intelligence_ladder_exhausted";
  error.attempts = attempts;
  throw error;
}
