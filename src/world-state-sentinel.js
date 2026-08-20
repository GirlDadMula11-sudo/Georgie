import { readCloudState, writeCloudState } from "./cloud-state.js";
import { buildWorldState } from "./world-state.js";

const NS = "universal_world_state_snapshot";
const USER = () => process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const INTERVAL = Math.max(60_000, Number(process.env.GEORGIE_WORLD_STATE_INTERVAL_MS || 5 * 60_000));
let timer = null, running = false;

export async function refreshWorldState(userId = USER()) {
  if (running) return readWorldStateSnapshot(userId);
  running = true;
  try { const state = await buildWorldState(userId, "continuous operating context", { domain: "general" }); await writeCloudState(String(userId), NS, state); return state; }
  finally { running = false; }
}
export async function readWorldStateSnapshot(userId = USER()) { return readCloudState(String(userId), NS, { version: "2026-08-20.2", generatedAt: null, commitments: [], continuity: { activeNodes: [], unfinishedJobs: [], nextActions: [], counts: {} }, recentDecisions: [], counts: {}, status: "not_yet_observed" }); }
export function startWorldStateSentinel() { if (process.env.GEORGIE_WORLD_STATE_ENABLED === "false" || timer) return; void refreshWorldState().catch((error) => console.warn("World-state refresh failed:", error instanceof Error ? error.message : error)); timer = setInterval(() => void refreshWorldState().catch((error) => console.warn("World-state refresh failed:", error instanceof Error ? error.message : error)), INTERVAL); timer.unref?.(); }
