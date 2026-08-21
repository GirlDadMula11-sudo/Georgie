import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { enqueueEvent } from "./events.js";
import { getSierraHealth, getSierraInfrastructure, sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";
import { getProviderObservability } from "./integrations/provider-observability.js";
import { getSmartleadCampaigns, smartleadConfigured } from "./integrations/smartlead.js";
import { certificationStatus, executeCertifiedRepair } from "./repair-runbooks.js";

const NS = "maintenance_sentinel";
const USER = () => process.env.GEORGIE_EXECUTIVE_USER_ID || process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const INTERVAL = Math.max(60_000, Number(process.env.GEORGIE_MAINTENANCE_INTERVAL_MS || 5 * 60_000));
const MODE = () => ["observe", "shadow", "bounded"].includes(process.env.GEORGIE_MAINTENANCE_MODE) ? process.env.GEORGIE_MAINTENANCE_MODE : "shadow";
const REPAIR_COOLDOWN_MS = Math.max(60_000, Number(process.env.GEORGIE_REPAIR_COOLDOWN_MS || 30 * 60_000));
const SOURCE_RUNBOOK = Object.freeze({
  deployment_providers: "provider.observability.refresh",
  sierra_health: "sierra.health.refresh",
  smartlead_campaigns: "smartlead.campaign.refresh"
});
let timer = null;
let running = false;

function now() { return new Date().toISOString(); }
function numericSignals(value, path = [], output = []) {
  if (!value || typeof value !== "object" || output.length >= 100) return output;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (typeof child === "number" && /fail|error|stale|conflict|dead.?letter|timeout|violation|backlog|pressure|lag/i.test(key) && child > 0) output.push({ path: nextPath.join("."), value: child });
    else if (child && typeof child === "object") numericSignals(child, nextPath, output);
  }
  return output;
}
async function capture(name, fn) {
  const startedAt = now();
  try { return { name, ok: true, startedAt, observedAt: now(), data: await fn() }; }
  catch (error) { return { name, ok: false, startedAt, observedAt: now(), error: error instanceof Error ? error.message : String(error), data: null }; }
}
function snapshotStatus(sources, signals) {
  if (sources.some((source) => !source.ok)) return "degraded_coverage";
  if (signals.length) return "attention_required";
  return "healthy_snapshot";
}
export function maintenanceControlBrief(state = {}) {
  const sources = Array.isArray(state.sources) ? state.sources : [];
  const signals = Array.isArray(state.signals) ? state.signals : [];
  const repairs = Array.isArray(state.repairs) ? state.repairs : [];
  const unavailable = sources.filter((source) => !source.ok).length;
  const latestRepair = repairs.at(-1);
  const evidenceCurrent = Boolean(state.observedAt) && sources.length > 0;
  const status = !evidenceCurrent ? "unknown" : unavailable ? "coverage_degraded" : signals.length ? "attention_required" : "healthy_snapshot";
  const headline = status === "healthy_snapshot"
    ? "Georgie's latest maintenance check found no evidence-backed operating risk."
    : status === "unknown"
      ? "Georgie has not completed a current maintenance check, so system health is not proven."
      : `Georgie needs attention: ${signals.length} verified signal${signals.length === 1 ? "" : "s"}${unavailable ? ` and ${unavailable} unavailable evidence source${unavailable === 1 ? "" : "s"}` : ""}.`;
  const nextMove = latestRepair?.result === "verified"
    ? `The latest bounded action, ${latestRepair.runbookId}, passed verification.`
    : state.repairAuthority?.boundedExecution
      ? "Georgie may run only a matching pre-certified reversible runbook; everything consequential remains approval-gated."
      : "Georgie will diagnose and prepare the exact repair. Consequential execution remains approval-gated.";
  return { status, headline, nextMove, evidenceCurrent, signals: signals.length, unavailableSources: unavailable, observedAt: state.observedAt || null };
}

function recentlyAttempted(repairs, runbookId, at = Date.now()) {
  return repairs.some((repair) => repair.runbookId === runbookId && at - Date.parse(repair.finishedAt || repair.startedAt || 0) < REPAIR_COOLDOWN_MS);
}

async function runEligibleBoundedRepairs(userId, state) {
  if (!state.repairAuthority?.boundedExecution) return [];
  const repairs = Array.isArray(state.repairs) ? state.repairs : [];
  const runbookIds = [...new Set((state.signals || []).map((signal) => SOURCE_RUNBOOK[signal.source]).filter(Boolean))];
  const outcomes = [];
  for (const runbookId of runbookIds) {
    if (recentlyAttempted(repairs, runbookId)) continue;
    const startedAt = now();
    const execution = await executeCertifiedRepair(userId, runbookId).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    const outcome = { id: crypto.randomUUID(), runbookId, startedAt, finishedAt: now(), result: execution.ok ? "verified" : "failed", evidence: execution };
    outcomes.push(outcome);
  }
  return outcomes;
}

export async function maintenanceStatus(userId = USER()) {
  return readCloudState(String(userId), NS, { mode: MODE(), status: "not_yet_observed", cycles: 0, verifiedHealthyCycles: 0, sources: [], signals: [], repairs: [], learning: { verifiedOutcomes: 0, failedOutcomes: 0 } });
}

export async function recordMaintenanceOutcome(userId, input = {}) {
  const uid = String(userId || USER());
  const state = await maintenanceStatus(uid);
  const result = input.result === "verified" ? "verified" : input.result === "failed" ? "failed" : "unknown";
  const outcome = { id: crypto.randomUUID(), repairId: String(input.repairId || ""), result, evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {}, observedAt: now() };
  const outcomes = [...(Array.isArray(state.outcomes) ? state.outcomes : []), outcome].slice(-1000);
  const learning = { verifiedOutcomes: outcomes.filter((item) => item.result === "verified").length, failedOutcomes: outcomes.filter((item) => item.result === "failed").length };
  await writeCloudState(uid, NS, { ...state, outcomes, learning, updatedAt: now() });
  return outcome;
}

export async function runMaintenanceCycle() {
  if (running) return { skipped: true, reason: "cycle_already_running" };
  running = true;
  const uid = USER();
  try {
    const previous = await maintenanceStatus(uid);
    const previousInfrastructure = Array.isArray(previous.sources) ? previous.sources.find((source) => source.name === "sierra_infrastructure") : null;
    const refreshInfrastructure = Number(previous.cycles || 0) % 3 === 0 || !previousInfrastructure;
    const sources = await Promise.all([
      capture("sierra_health", () => sierraWorkforceConfigured() ? getSierraHealth(uid) : Promise.reject(new Error("Sierra Workforce is not configured"))),
      refreshInfrastructure
        ? capture("sierra_infrastructure", () => sierraWorkforceConfigured() ? getSierraInfrastructure(uid) : Promise.reject(new Error("Sierra Workforce is not configured")))
        : Promise.resolve({ ...previousInfrastructure, cached: true, reusedAt: now() }),
      capture("deployment_providers", () => getProviderObservability())
      ,capture("smartlead_campaigns", () => smartleadConfigured() ? getSmartleadCampaigns() : Promise.reject(new Error("Smartlead API is not configured")))
    ]);
    const signals = sources.flatMap((source) => source.ok ? numericSignals(source.data).map((signal) => ({ ...signal, source: source.name, observedAt: source.observedAt })) : [{ source: source.name, path: "connection", value: 1, observedAt: source.observedAt, error: source.error }]);
    const status = snapshotStatus(sources, signals);
    const healthy = status === "healthy_snapshot";
    const certification=await certificationStatus(uid,previous);
    const bounded=MODE()==="bounded"&&certification.certified;
    let state = {
      ...previous,
      mode: MODE(),
      status,
      observedAt: now(),
      cycles: Number(previous.cycles || 0) + 1,
      verifiedHealthyCycles: healthy ? Number(previous.verifiedHealthyCycles || 0) + 1 : 0,
      sources,
      signals,
      repairAuthority: { observe: true, diagnose: true, simulate: true, prepare: true, boundedExecution: bounded, consequentialExecution: false, selfModifyingCode: false },
      certification,
      campaignCoverage: { providerDirectRequired: true, smartleadDirectConnected: smartleadConfigured(), status: smartleadConfigured()?"provider_direct":"connector_required" },
      lastCycleId: crypto.randomUUID(),
      updatedAt: now()
    };
    await writeCloudState(uid, NS, state);
    const repairOutcomes = await runEligibleBoundedRepairs(uid, state);
    if (repairOutcomes.length) {
      const recordedOutcomes = repairOutcomes.map((item) => ({ id: item.id, repairId: item.runbookId, result: item.result, evidence: item.evidence, observedAt: item.finishedAt }));
      const outcomes = [...(Array.isArray(previous.outcomes) ? previous.outcomes : []), ...recordedOutcomes].slice(-1000);
      state = {
        ...state,
        repairs: [...(Array.isArray(previous.repairs) ? previous.repairs : []), ...repairOutcomes].slice(-250),
        outcomes,
        learning: { verifiedOutcomes: outcomes.filter((item) => item.result === "verified").length, failedOutcomes: outcomes.filter((item) => item.result === "failed").length },
        updatedAt: now()
      };
      await writeCloudState(uid, NS, state);
    }
    if (!healthy) await enqueueEvent({ userId: uid, type: "maintenance.attention", title: "Georgie maintenance detected operating risk", body: `${signals.length} evidence-backed maintenance signal${signals.length === 1 ? "" : "s"} require diagnosis.`, priority: sources.some((source) => !source.ok) ? "urgent" : "high", dedupeKey: `maintenance:${status}:${signals.map((item) => `${item.source}:${item.path}:${item.value}`).sort().join("|").slice(0, 800)}`, data: { cycleId: state.lastCycleId, mode: state.mode, status, signals, sources: sources.map(({ name, ok, observedAt, error }) => ({ name, ok, observedAt, error })) } });
    return state;
  } finally { running = false; }
}

export function startMaintenanceSentinel() {
  if (process.env.GEORGIE_MAINTENANCE_ENABLED === "false") return;
  if (timer) return;
  void runMaintenanceCycle().catch((error) => console.warn("Georgie maintenance cycle failed:", error instanceof Error ? error.message : error));
  timer = setInterval(() => void runMaintenanceCycle().catch((error) => console.warn("Georgie maintenance cycle failed:", error instanceof Error ? error.message : error)), INTERVAL);
  timer.unref?.();
}

export function stopMaintenanceSentinel() { if (timer) clearInterval(timer); timer = null; }
