import { startCloudStateRecovery } from "./cloud-state.js";
import { startApprovalDispatchWorker } from "./tools.js";
import { startEngineeringCoordinator } from "./engineering-coordinator.js";
import { startMaintenanceSentinel } from "./maintenance-sentinel.js";
import { startReconciliationWorkers } from "./reconciliation-workers.js";
import { startBackgroundOperatingLayer } from "./background-operating-layer.js";
import { startSelfEvolution } from "./self-evolution.js";
import { startObjectiveWorker } from "./objective-worker.js";
import { startSeoMonitorScheduler } from "./seo-monitor.js";
import { startSmartleadReplyCloserWorker } from "./smartlead-reply-closer-worker.js";
import { startLenderDeliveryWorker } from "./lender-delivery-worker.js";
import { startSierraClosingOutreachWorker } from "./sierra-closing-outreach-worker.js";
import { startMobileTurnRecovery } from "./mobile-router.js";
import { startProactiveEngine } from "./proactive.js";
import { startEmailIntelligence } from "./email-worker.js";
import { startWorldStateSentinel } from "./world-state-sentinel.js";
import { startRevenueController } from "./revenue-controller.js";
import { startIntelligenceControlMap } from "./intelligence-control-map.js";
import { startConnectorHeartbeatMonitor } from "./connector-oauth.js";

// Phase 1 authority map. Runtime components may start only through this registry.
// `authority` describes the state a component may own; `observer` components may
// inspect and recommend but must not become competing objective authorities.
const SPECIALIST_COMPONENT_IDS = new Set(["seo-monitor", "smartlead-reply-closer", "lender-delivery", "sierra-closing-outreach"]);
const KERNEL_COMPONENT_IDS = new Set([
  "cloud-state-recovery",
  "mobile-turn-recovery",
  "approval-dispatch",
  "engineering-coordinator",
  "objective-worker"
]);

export const RUNTIME_MODES = Object.freeze(["kernel", "full"]);

function previewWorkerIds(env = process.env) {
  return new Set(String(env.GEORGIE_PREVIEW_WORKER_ALLOWLIST || "").split(",").map(value => value.trim()).filter(Boolean));
}

export function runtimeOwnsBackgroundWorkers(env = process.env) {
  if (String(env.IS_PULL_REQUEST || "").toLowerCase() === "true") {
    return String(env.GEORGIE_PREVIEW_WORKERS_ENABLED || "").toLowerCase() === "true" && previewWorkerIds(env).size > 0;
  }
  return !env.VERCEL && !env.AWS_LAMBDA_FUNCTION_NAME && !env.LAMBDA_TASK_ROOT;
}

export function runtimeMode(env = process.env) {
  const requested = String(env.GEORGIE_RUNTIME_MODE || "kernel").trim().toLowerCase();
  return RUNTIME_MODES.includes(requested) ? requested : "kernel";
}

const COMPONENT_DEFINITIONS = [
  { id: "cloud-state-recovery", profiles: ["web", "worker"], role: "recovery", authority: "cloud-state-mirror", start: startCloudStateRecovery },
  { id: "mobile-turn-recovery", profiles: ["web"], role: "recovery", authority: "mobile-turns", start: startMobileTurnRecovery },
  { id: "proactive-engine", profiles: ["web"], role: "scheduler", authority: "proactive-events", start: startProactiveEngine },
  { id: "email-intelligence", profiles: ["web"], role: "executor", authority: "neo-mail-triage", start: startEmailIntelligence },
  { id: "approval-dispatch", profiles: ["web", "worker"], role: "executor", authority: "approved-tool-dispatch", start: startApprovalDispatchWorker },
  { id: "maintenance-sentinel", profiles: ["web", "worker"], role: "observer", authority: null, start: startMaintenanceSentinel },
  { id: "reconciliation", profiles: ["web", "worker"], role: "observer", authority: null, start: startReconciliationWorkers },
  { id: "self-evolution", profiles: ["web", "worker"], role: "observer", authority: null, start: startSelfEvolution },
  { id: "background-operating-layer", profiles: ["web", "worker"], role: "observer", authority: null, start: startBackgroundOperatingLayer },
  { id: "engineering-coordinator", profiles: ["web", "worker"], role: "executor", authority: "engineering-handoffs", start: startEngineeringCoordinator },
  { id: "world-state-sentinel", profiles: ["web"], role: "observer", authority: null, start: startWorldStateSentinel },
  { id: "revenue-controller", profiles: ["web"], role: "observer", authority: null, start: startRevenueController },
  { id: "intelligence-control-map", profiles: ["web"], role: "observer", authority: null, start: startIntelligenceControlMap },
  { id: "connector-heartbeat", profiles: ["web"], role: "observer", authority: null, start: startConnectorHeartbeatMonitor },
  { id: "objective-worker", profiles: ["web"], role: "kernel", authority: "objective-lifecycle", start: startObjectiveWorker },
  { id: "seo-monitor", profiles: ["web"], role: "scheduler", authority: "seo-schedule", start: startSeoMonitorScheduler },
  { id: "smartlead-reply-closer", profiles: ["web", "worker"], role: "executor", authority: "smartlead-replies", start: startSmartleadReplyCloserWorker },
  { id: "lender-delivery", profiles: ["web"], role: "executor", authority: "lender-delivery", start: startLenderDeliveryWorker },
  { id: "sierra-closing-outreach", profiles: ["web", "worker"], role: "executor", authority: "closing-outreach", start: startSierraClosingOutreachWorker },
];

export const RUNTIME_COMPONENTS = Object.freeze(COMPONENT_DEFINITIONS.map(component => Object.freeze({
  ...component,
  plane: SPECIALIST_COMPONENT_IDS.has(component.id) ? "specialist" : "core"
})));

export function validateRuntimeRegistry(components = RUNTIME_COMPONENTS) {
  const ids = new Set();
  const errors = [];
  for (const component of components) {
    if (!component?.id || ids.has(component.id)) errors.push(`duplicate-or-missing-id:${component?.id || "unknown"}`);
    ids.add(component?.id);
    if (!Array.isArray(component?.profiles) || !component.profiles.length) errors.push(`missing-profile:${component?.id}`);
    if (typeof component?.start !== "function") errors.push(`missing-start:${component?.id}`);
    if (!["core", "specialist"].includes(component?.plane)) errors.push(`invalid-plane:${component?.id}`);
    if (component?.role === "kernel" && component?.authority !== "objective-lifecycle") errors.push(`invalid-kernel-authority:${component?.id}`);
    if (component?.role === "kernel" && component?.plane !== "core") errors.push(`specialist-kernel:${component?.id}`);
  }
  const kernels = components.filter(component => component.role === "kernel");
  if (kernels.length !== 1) errors.push(`kernel-count:${kernels.length}`);
  return { ok: errors.length === 0, errors, componentCount: components.length, kernel: kernels[0]?.id || null };
}

export const SPECIALIST_START_DELAY_MS = Math.max(250, Math.min(30_000, Number(process.env.GEORGIE_SPECIALIST_START_DELAY_MS || 1_500)));

export function componentsForProfile(profile, components = RUNTIME_COMPONENTS, plane = null, mode = runtimeMode(), env = process.env) {
  const preview = String(env.IS_PULL_REQUEST || "").toLowerCase() === "true";
  const allowedPreviewWorkers = previewWorkerIds(env);
  return components.filter(component => component.profiles.includes(profile)
    && (!plane || component.plane === plane)
    && (mode === "full" || KERNEL_COMPONENT_IDS.has(component.id))
    && (!preview || allowedPreviewWorkers.has(component.id)));
}

export function startRuntimeProfile(profile, { logger = console, components = RUNTIME_COMPONENTS, plane = null, mode = runtimeMode() } = {}) {
  const validation = validateRuntimeRegistry(components);
  if (!validation.ok) throw new Error(`Invalid Georgie runtime registry: ${validation.errors.join(",")}`);
  const selected = componentsForProfile(profile, components, plane, mode);
  if (!selected.length) throw new Error(`Unknown or empty Georgie runtime profile: ${profile}${plane ? `/${plane}` : ""}`);
  const started = [];
  const degraded = [];
  for (const component of selected) {
    try {
      component.start();
      started.push(component.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (component.plane === "core") throw new Error(`Core runtime component failed: ${component.id}: ${detail}`, { cause: error });
      degraded.push({ id: component.id, error: detail });
      logger.warn(`Georgie specialist isolated: ${component.id}: ${detail}`);
    }
  }
  logger.log(`Georgie ${webProfile(profile, plane)} online in ${mode} mode (${started.join(", ")})`);
  return { profile, plane, mode, started, degraded, kernel: validation.kernel };
}

function webProfile(profile, plane) {
  return `${profile}${plane ? `/${plane}` : ""} profile`;
}

export function scheduleRuntimePlane(profile, plane, { delayMs = SPECIALIST_START_DELAY_MS, logger = console, components = RUNTIME_COMPONENTS, schedule = setTimeout, mode = runtimeMode() } = {}) {
  if (mode !== "full") {
    logger.log(`Georgie ${webProfile(profile, plane)} disabled in ${mode} mode`);
    return { profile, plane, mode, delayMs: null, timer: null, disabled: true };
  }
  const boundedDelayMs = Math.max(0, Math.min(30_000, Number(delayMs) || 0));
  const timer = schedule(() => {
    try {
      startRuntimeProfile(profile, { logger, components, plane, mode });
    } catch (error) {
      logger.warn(`Georgie ${profile}/${plane} plane failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, boundedDelayMs);
  timer?.unref?.();
  logger.log(`Georgie ${profile}/${plane} plane scheduled after ${boundedDelayMs}ms`);
  return { profile, plane, mode, delayMs: boundedDelayMs, timer, disabled: false };
}
