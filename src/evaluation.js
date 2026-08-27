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
    firstResponseMs: Math.max(0, Number(input.firstResponseMs) || 0),
    contextReadyMs: Math.max(0, Number(input.contextReadyMs) || 0),
    toolCount: Math.max(0, Number(input.toolCount) || 0),
    evidenceCount: evidence.length,
    evidenceFreshness: evidence.length ? "observed_this_turn" : "none",
    highImpact: Boolean(input.route?.highImpact),
    unsupportedClaimRisk: input.route?.requiresCurrentEvidence && !evidence.length ? "review_required" : "bounded",
    executionAuthority: "observe_recommend_prepare",
    responseCharacters: Math.max(0, Number(input.responseCharacters) || 0),
    completed: input.completed !== false,
    actionSuccess: input.toolCount ? Boolean(input.actionSuccess) : null,
    resumeFidelity: input.resumeFidelity == null ? null : Boolean(input.resumeFidelity),
    routingCorrect: input.routingCorrect == null ? null : Boolean(input.routingCorrect),
    terminalReceiptVerified: input.terminalReceiptVerified == null ? null : Boolean(input.terminalReceiptVerified)
  };
  evaluations.push(item);
  await writeCloudState(uid, NS, { evaluations: evaluations.slice(-5000), updatedAt: now() });
  return item;
}

export async function recordClientTelemetry(userId, input = {}) {
  const uid = String(userId || "primary");
  const state = await readCloudState(uid, NS, { evaluations: [], clientTelemetry: [], feedback: [] });
  const clientTelemetry = Array.isArray(state.clientTelemetry) ? state.clientTelemetry : [];
  const item = {
    id: crypto.randomUUID(), createdAt: now(), platform: bounded(input.platform || "web", 40),
    route: bounded(input.route || "respond_stream", 80),
    headersMs: Math.max(0, Number(input.headersMs) || 0), firstEventMs: Math.max(0, Number(input.firstEventMs) || 0),
    firstDeltaMs: Math.max(0, Number(input.firstDeltaMs) || 0), completeMs: Math.max(0, Number(input.completeMs) || 0),
    connectionReused: Boolean(input.connectionReused)
  };
  clientTelemetry.push(item);
  await writeCloudState(uid, NS, { ...state, clientTelemetry: clientTelemetry.slice(-2000), updatedAt: now() });
  return item;
}

export async function recordOutcomeFeedback(userId, input = {}) {
  const uid = String(userId || "primary");
  const state = await readCloudState(uid, NS, { evaluations: [], clientTelemetry: [], feedback: [] });
  const feedback = Array.isArray(state.feedback) ? state.feedback : [];
  const item = { id: crypto.randomUUID(), createdAt: now(), responseId: bounded(input.responseId, 180), domain: bounded(input.domain || "general", 40), useful: Boolean(input.useful), reason: bounded(input.reason, 300) };
  feedback.push(item);
  await writeCloudState(uid, NS, { ...state, feedback: feedback.slice(-2000), updatedAt: now() });
  return item;
}

export async function evaluationScorecard(userId, { limit = 200 } = {}) {
  const state = await readCloudState(String(userId || "primary"), NS, { evaluations: [], clientTelemetry: [], feedback: [] });
  const items = (Array.isArray(state.evaluations) ? state.evaluations : []).slice(-Math.max(1, Math.min(Number(limit) || 200, 1000)));
  const averageLatencyMs = items.length ? Math.round(items.reduce((sum, item) => sum + item.latencyMs, 0) / items.length) : 0;
  const actionItems = items.filter((item) => item.actionSuccess !== null && item.actionSuccess !== undefined);
  const percentile = (values, quantile) => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] : 0; };
  const firstResponseValues = items.map((item) => Number(item.firstResponseMs)).filter((value) => value > 0);
  const totalLatencyValues = items.map((item) => Number(item.latencyMs)).filter((value) => value > 0);
  const clientItems = (Array.isArray(state.clientTelemetry) ? state.clientTelemetry : []).slice(-Math.max(1, Math.min(Number(limit) || 200, 1000)));
  const feedback = (Array.isArray(state.feedback) ? state.feedback : []).slice(-Math.max(1, Math.min(Number(limit) || 200, 1000)));
  const firstDeltaValues = clientItems.map((item) => Number(item.firstDeltaMs)).filter((value) => value > 0);
  const tierDistribution = Object.fromEntries(["fast", "balanced", "frontier"].map((tier) => [tier, items.filter((item) => item.tier === tier).length]));
  return {
    sampleSize: items.length,
    averageLatencyMs,
    latency: {
      firstResponseP50Ms: percentile(firstResponseValues, 0.5),
      firstResponseP95Ms: percentile(firstResponseValues, 0.95),
      completionP50Ms: percentile(totalLatencyValues, 0.5),
      completionP95Ms: percentile(totalLatencyValues, 0.95)
    },
    realDeviceTransport: { sampleSize: clientItems.length, firstDeltaP50Ms: percentile(firstDeltaValues, 0.5), firstDeltaP95Ms: percentile(firstDeltaValues, 0.95) },
    outcomeFeedback: { sampleSize: feedback.length, usefulnessRate: feedback.length ? Number((feedback.filter((item) => item.useful).length / feedback.length).toFixed(3)) : null, byDomain: Object.fromEntries(["personal","sierra","research","creative","execution","general"].map((domain) => { const rows=feedback.filter((item)=>item.domain===domain); return [domain,{sampleSize:rows.length,usefulnessRate:rows.length?Number((rows.filter((item)=>item.useful).length/rows.length).toFixed(3)):null}]; })) },
    evidenceCoverage: items.length ? Number((items.filter((item) => item.evidenceCount > 0).length / items.length).toFixed(3)) : 0,
    highImpactReviewRequired: items.filter((item) => item.highImpact && item.unsupportedClaimRisk === "review_required").length,
    completionRate: items.length ? Number((items.filter((item) => item.completed).length / items.length).toFixed(3)) : 0,
    actionSuccessRate: actionItems.length ? Number((actionItems.filter((item) => item.actionSuccess).length / actionItems.length).toFixed(3)) : null,
    resumeFidelityRate: items.filter(i=>i.resumeFidelity!==null&&i.resumeFidelity!==undefined).length ? Number((items.filter(i=>i.resumeFidelity===true).length / items.filter(i=>i.resumeFidelity!==null&&i.resumeFidelity!==undefined).length).toFixed(3)) : null,
    routingCorrectnessRate: items.filter(i=>i.routingCorrect!==null&&i.routingCorrect!==undefined).length ? Number((items.filter(i=>i.routingCorrect===true).length / items.filter(i=>i.routingCorrect!==null&&i.routingCorrect!==undefined).length).toFixed(3)) : null,
    terminalReceiptVerificationRate: items.filter(i=>i.terminalReceiptVerified!==null&&i.terminalReceiptVerified!==undefined).length ? Number((items.filter(i=>i.terminalReceiptVerified===true).length / items.filter(i=>i.terminalReceiptVerified!==null&&i.terminalReceiptVerified!==undefined).length).toFixed(3)) : null,
    tierDistribution,
    inexpensiveRoutingRate: items.length ? Number((items.filter((item) => ["fast", "balanced"].includes(item.tier)).length / items.length).toFixed(3)) : 0,
    latencyTargets: { simpleAnswerMs: 2000, routineActionMs: 5000, complexFirstResponseMs: 3000 },
    executionAuthority: "observe_recommend_prepare",
    certificationStatus: "not_certified"
  };
}
