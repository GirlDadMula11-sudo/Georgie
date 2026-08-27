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

// Phase 1 authority map. Runtime components may start only through this registry.
// `authority` describes the state a component may own; `observer` components may
// inspect and recommend but must not become competing objective authorities.
export const RUNTIME_COMPONENTS = Object.freeze([
  { id: "cloud-state-recovery", profiles: ["web", "worker"], role: "recovery", authority: "cloud-state-mirror", start: startCloudStateRecovery },
  { id: "approval-dispatch", profiles: ["web", "worker"], role: "executor", authority: "approved-tool-dispatch", start: startApprovalDispatchWorker },
  { id: "maintenance-sentinel", profiles: ["web", "worker"], role: "observer", authority: null, start: startMaintenanceSentinel },
  { id: "reconciliation", profiles: ["web", "worker"], role: "observer", authority: null, start: startReconciliationWorkers },
  { id: "self-evolution", profiles: ["web", "worker"], role: "observer", authority: null, start: startSelfEvolution },
  { id: "background-operating-layer", profiles: ["web", "worker"], role: "observer", authority: null, start: startBackgroundOperatingLayer },
  { id: "engineering-coordinator", profiles: ["web", "worker"], role: "executor", authority: "engineering-handoffs", start: startEngineeringCoordinator },
  { id: "objective-worker", profiles: ["web"], role: "kernel", authority: "objective-lifecycle", start: startObjectiveWorker },
  { id: "seo-monitor", profiles: ["web"], role: "scheduler", authority: "seo-schedule", start: startSeoMonitorScheduler },
  { id: "smartlead-reply-closer", profiles: ["web", "worker"], role: "executor", authority: "smartlead-replies", start: startSmartleadReplyCloserWorker },
  { id: "lender-delivery", profiles: ["web"], role: "executor", authority: "lender-delivery", start: startLenderDeliveryWorker },
  { id: "sierra-closing-outreach", profiles: ["web", "worker"], role: "executor", authority: "closing-outreach", start: startSierraClosingOutreachWorker },
]);

export function validateRuntimeRegistry(components = RUNTIME_COMPONENTS) {
  const ids = new Set();
  const errors = [];
  for (const component of components) {
    if (!component?.id || ids.has(component.id)) errors.push(`duplicate-or-missing-id:${component?.id || "unknown"}`);
    ids.add(component?.id);
    if (!Array.isArray(component?.profiles) || !component.profiles.length) errors.push(`missing-profile:${component?.id}`);
    if (typeof component?.start !== "function") errors.push(`missing-start:${component?.id}`);
    if (component?.role === "kernel" && component?.authority !== "objective-lifecycle") errors.push(`invalid-kernel-authority:${component?.id}`);
  }
  const kernels = components.filter(component => component.role === "kernel");
  if (kernels.length !== 1) errors.push(`kernel-count:${kernels.length}`);
  return { ok: errors.length === 0, errors, componentCount: components.length, kernel: kernels[0]?.id || null };
}

export function componentsForProfile(profile, components = RUNTIME_COMPONENTS) {
  return components.filter(component => component.profiles.includes(profile));
}

export function startRuntimeProfile(profile, { logger = console } = {}) {
  const validation = validateRuntimeRegistry();
  if (!validation.ok) throw new Error(`Invalid Georgie runtime registry: ${validation.errors.join(",")}`);
  const selected = componentsForProfile(profile);
  if (!selected.length) throw new Error(`Unknown or empty Georgie runtime profile: ${profile}`);
  const started = [];
  for (const component of selected) {
    component.start();
    started.push(component.id);
  }
  logger.log(`Georgie ${profile} profile online (${started.join(", ")})`);
  return { profile, started, kernel: validation.kernel };
}
