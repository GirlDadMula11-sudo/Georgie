import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";

const NS = "intelligence_evaluations";
function now() { return new Date().toISOString(); }
function bounded(value, max = 500) { return String(value || "").slice(0, max); }

export async function recordTurnEvaluation(userId, input = {}) {
  const uid = String(userId || "primary");
  const state = await readCloudState(uid, NS, { evaluations: [] });
  const evaluations = Array.isArray(state.evaluations) ? state.evaluations : [];
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const item = {
    id: crypto.randomUUID(),
    createdAt: now(),
    routeVersion: bounded(input.route?.version, 80),
    domain: bounded(input.route?.domain || "general", 40),
    tier: bounded(input.route?.tier, 40),
    model: bounded(input.model, 120),
    latencyMs: Math.max(0, Number(input.latencyMs) || 0),
    toolCount: Math.max(0, Number(input.toolCount) || 0),
    evidenceCount: evidence.length,
    evidenceFreshness: evidence.length ? "observed_this_turn" : "none",
    highImpact: Boolean(input.route?.highImpact),
    unsupportedClaimRisk: input.route?.requiresCurrentEvidence && !evidence.length ? "review_required" : "bounded",
    executionAuthority: "observe_recommend_prepare",
    responseCharacters: Math.max(0, Number(input.responseCharacters) || 0),
    completed: input.completed !== false,
    actionSuccess: input.toolCount ? Boolean(input.actionSuccess) : null
  };
  evaluations.push(item);
  await writeCloudState(uid, NS, { evaluations: evaluations.slice(-5000), updatedAt: now() });
  return item;
}

export async function evaluationScorecard(userId, { limit = 200 } = {}) {
  const state = await readCloudState(String(userId || "primary"), NS, { evaluations: [] });
  const items = (Array.isArray(state.evaluations) ? state.evaluations : []).slice(-Math.max(1, Math.min(Number(limit) || 200, 1000)));
  const averageLatencyMs = items.length ? Math.round(items.reduce((sum, item) => sum + item.latencyMs, 0) / items.length) : 0;
  const actionItems = items.filter((item) => item.actionSuccess !== null && item.actionSuccess !== undefined);
  return {
    sampleSize: items.length,
    averageLatencyMs,
    evidenceCoverage: items.length ? Number((items.filter((item) => item.evidenceCount > 0).length / items.length).toFixed(3)) : 0,
    highImpactReviewRequired: items.filter((item) => item.highImpact && item.unsupportedClaimRisk === "review_required").length,
    completionRate: items.length ? Number((items.filter((item) => item.completed).length / items.length).toFixed(3)) : 0,
    actionSuccessRate: actionItems.length ? Number((actionItems.filter((item) => item.actionSuccess).length / actionItems.length).toFixed(3)) : null,
    executionAuthority: "observe_recommend_prepare",
    certificationStatus: "not_certified"
  };
}
