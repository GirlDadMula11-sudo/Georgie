import { readCloudState, writeCloudState } from "./cloud-state.js";
import { enqueueEvent } from "./events.js";
import { getSierraHealth, getSierraInfrastructure, queueSierraAction, sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";

const NS = "scheduled_reconciliation";
const USER = () => process.env.GEORGIE_EXECUTIVE_USER_ID || process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const INTERVAL = Math.max(60_000, Number(process.env.GEORGIE_RECONCILIATION_INTERVAL_MS || 5 * 60_000));
const LANES = ["intake_transfer", "missing_application_date", "funding_evidence", "health_reconciliation"];
let timer = null, running = false;
function mode() { if (process.env.GEORGIE_AUTOMATION_KILL_SWITCH === "true") return "paused"; return process.env.GEORGIE_RECONCILIATION_MODE === "bounded" ? "bounded" : "shadow"; }
export function resolveReconciliationMode(configuredMode, requestedMode) { return configuredMode === "paused" ? "paused" : requestedMode === "bounded" ? "bounded" : configuredMode === "bounded" ? "bounded" : "shadow"; }
export async function reconciliationStatus(userId = USER()) { return readCloudState(String(userId), NS, { mode: mode(), cycles: 0, lanes: [], lastRunAt: null }); }

export async function runReconciliationCycle({ requestedMode = null, userId: requestedUserId = null } = {}) {
  if (running) return { skipped: true, reason: "cycle_already_running" };
  running = true; const userId = String(requestedUserId || USER());
  try {
    const configuredMode = mode();
    const currentMode = resolveReconciliationMode(configuredMode, requestedMode);
    const previous = await reconciliationStatus(userId), observedAt = new Date().toISOString();
    if (currentMode === "paused") { const paused = { ...previous, mode: currentMode, pausedByKillSwitch: true, lastRunAt: observedAt }; await writeCloudState(userId, NS, paused); return paused; }
    if (!sierraWorkforceConfigured()) throw new Error("Sierra Workforce is not configured");
    const [health, infrastructure] = await Promise.all([getSierraHealth(userId), getSierraInfrastructure(userId)]);
    const lanes = [];
    for (const lane of LANES) {
      if (currentMode !== "bounded") { lanes.push({ lane, status: "observed_only" }); continue; }
      try { lanes.push({ lane, status: "queued", result: await queueSierraAction(userId, { reference: "", action: lane, reason: `Georgie scheduled ${lane.replaceAll("_", " ")} cycle` }) }); }
      catch (error) { lanes.push({ lane, status: "failed", error: error instanceof Error ? error.message : String(error) }); }
    }
    const state = { mode: currentMode, cycles: Number(previous.cycles || 0) + 1, observedAt, lastRunAt: observedAt, lanes, evidence: { health, infrastructure } };
    await writeCloudState(userId, NS, state);
    const failures = lanes.filter((lane) => lane.status === "failed");
    if (failures.length) await enqueueEvent({ userId, type: "reconciliation.failure", title: "Georgie reconciliation needs attention", body: `${failures.length} scheduled reconciliation lane${failures.length === 1 ? "" : "s"} failed to queue.`, priority: "high", dedupeKey: `reconciliation:${failures.map((item) => item.lane).sort().join("|")}`, data: { failures, observedAt } });
    return state;
  } finally { running = false; }
}

export function startReconciliationWorkers() {
  if (process.env.GEORGIE_RECONCILIATION_ENABLED === "false" || timer) return;
  void runReconciliationCycle().catch((error) => console.warn("Georgie reconciliation cycle failed:", error instanceof Error ? error.message : error));
  timer = setInterval(() => void runReconciliationCycle().catch((error) => console.warn("Georgie reconciliation cycle failed:", error instanceof Error ? error.message : error)), INTERVAL);
  timer.unref?.();
}
