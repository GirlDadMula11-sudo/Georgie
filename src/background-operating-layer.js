import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { enqueueEvent } from "./events.js";
import { listApprovals } from "./command-layer.js";
import { revenueControllerStatus, runRevenueControllerCycle } from "./revenue-controller.js";

const NS = "background_operating_layer_v1";
const USER = () => process.env.GEORGIE_EXECUTIVE_USER_ID || process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const INTERVAL = Math.max(60_000, Number(process.env.GEORGIE_BACKGROUND_INTERVAL_MS || 60_000));
const TIME_ZONE = "America/New_York";
const POLICY = Object.freeze({ dailyBriefHour: 8, quietStartHour: 22, quietEndHour: 7, timeZone: TIME_ZONE });
let timer = null;
let running = false;

const now = () => new Date().toISOString();
function easternParts(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
function dayKey(at = new Date()) { const p = easternParts(at); return `${p.year}-${p.month}-${p.day}`; }
export function notificationWindow(at = new Date()) {
  const p = easternParts(at), hour = Number(p.hour) % 24;
  return { day: dayKey(at), hour, quiet: hour >= POLICY.quietStartHour || hour < POLICY.quietEndHour, dailyBriefDue: hour === POLICY.dailyBriefHour };
}
function defaultState() {
  return { version: 1, active: true, mode: "observe_notify", policy: POLICY, lastCycleAt: null, lastDailyBriefDay: null, delivered: {}, incidents: [], cycles: 0, killSwitchObserved: false };
}
function fingerprint(type, data) { return crypto.createHash("sha256").update(`${type}:${JSON.stringify(data)}`).digest("hex").slice(0, 24); }
function stableIncidentEvidence(evidence = {}) { const { observedAt: _observedAt, ...stable } = evidence; return stable; }
async function recipient() {
  if (process.env.GEORGIE_EXECUTIVE_EMAIL) return process.env.GEORGIE_EXECUTIVE_EMAIL;
  const { listNeoMailboxes } = await import("./integrations/neo-mail.js");
  return listNeoMailboxes().find((mailbox) => mailbox.id === "work" || mailbox.role === "executive_work")?.email || null;
}
function currentIncidents(controller = {}) {
  const controls = controller.controls || {}, assignments = Array.isArray(controller.assignments) ? controller.assignments : [], incidents = [];
  if (Number(controls.pipelineFailures || 0) > 0) incidents.push({ type: "pipeline_failure", severity: "critical", title: "Sierra pipeline failure detected", detail: `${controls.pipelineFailures} pipeline failure${controls.pipelineFailures === 1 ? "" : "s"} require immediate diagnosis.`, evidence: { pipelineFailures: controls.pipelineFailures, observedAt: controller.observedAt } });
  if (Number(controls.reconciliationExceptions || 0) > 0) incidents.push({ type: "reconciliation_exception", severity: "critical", title: "Revenue-chain reconciliation exception", detail: `${controls.reconciliationExceptions} cross-system exception${controls.reconciliationExceptions === 1 ? "" : "s"} detected.`, evidence: { reconciliationExceptions: controls.reconciliationExceptions, observedAt: controller.observedAt } });
  if (Number(controls.staleAutomation || 0) > 0) incidents.push({ type: "stale_automation", severity: "critical", title: "Sierra automation is stale", detail: `${controls.staleAutomation} stale automation record${controls.staleAutomation === 1 ? "" : "s"} detected.`, evidence: { staleAutomation: controls.staleAutomation, observedAt: controller.observedAt } });
  for (const deal of assignments.filter((row) => row.attention === "urgent" || Number(row.attentionScore || 0) >= 90)) incidents.push({ type: "urgent_deal", severity: "critical", title: `Urgent deal: ${deal.business}`, detail: `${deal.reference}: ${deal.nextAction}`, evidence: { reference: deal.reference, stage: deal.stage, state: deal.state, attentionScore: deal.attentionScore, observedAt: controller.observedAt } });
  return incidents;
}
function briefText(controller = {}, approvals = [], incidents = []) {
  const c = controller.coverage || {}, controls = controller.controls || {}, top = (controller.assignments || []).slice(0, 5);
  return [
    "SIERRA DAILY CONTROL BRIEF",
    `Generated: ${now()}`,
    "",
    `Active deals monitored: ${c.assignedDeals ?? 0}`,
    `Waiting on system work: ${c.waitingSystem ?? 0}`,
    `Waiting on human action: ${c.waitingHuman ?? 0}`,
    `Submitted to lenders: ${c.lenderSubmitted ?? 0}`,
    `Offers visible: ${c.offersAvailable ?? 0}`,
    `Pipeline failures: ${controls.pipelineFailures ?? "unknown"}`,
    `Reconciliation exceptions: ${controls.reconciliationExceptions ?? "unknown"}`,
    `Critical incidents: ${incidents.length}`,
    `Approvals waiting: ${approvals.length}`,
    "",
    "Highest-priority next actions:",
    ...(top.length ? top.map((deal) => `- ${deal.business} (${deal.reference}): ${deal.nextAction}`) : ["- No current deal actions returned."]),
    "",
    "No lender submission, external business communication, financial action, credential change, or consequential production mutation was performed by this monitor."
  ].join("\n");
}
async function deliver({ subject, text, key, state, critical = false }) {
  if (state.delivered?.[key]) return { status: "deduplicated", key };
  const window = notificationWindow();
  if (window.quiet && !critical) return { status: "held_for_quiet_hours", key };
  const { neoMailConfigured, sendMessage } = await import("./integrations/neo-mail.js");
  if (!neoMailConfigured()) return { status: "email_not_configured", key };
  const to = await recipient(); if (!to) return { status: "recipient_not_configured", key };
  const result = await sendMessage("work", { to, subject, text });
  if (!(result.accepted || []).length) return { status: "provider_unconfirmed", key, result };
  state.delivered[key] = { at: now(), messageId: result.messageId || null, accepted: result.accepted };
  return { status: "delivered", key, messageId: result.messageId || null };
}

export async function backgroundOperatingStatus(userId = USER()) { const state = await readCloudState(String(userId || USER()), NS, defaultState()); return { ...defaultState(), ...state }; }
export async function activateBackgroundOperatingLayer(userId = USER()) { const uid = String(userId || USER()), prior = await backgroundOperatingStatus(uid); const state = { ...prior, active: true, mode: "observe_notify", activatedAt: prior.activatedAt || now(), updatedAt: now() }; await writeCloudState(uid, NS, state); return runBackgroundOperatingCycle(uid); }
export async function runBackgroundOperatingCycle(userId = USER(), { at = new Date() } = {}) {
  if (running) return { status: "already_running" }; running = true;
  const uid = String(userId || USER());
  try {
    const state = await backgroundOperatingStatus(uid);
    if (!state.active) return { status: "inactive" };
    const killed = process.env.GEORGIE_AUTOMATION_KILL_SWITCH === "true";
    state.killSwitchObserved = killed;
    if (killed) { state.lastCycleAt = now(); state.updatedAt = now(); await writeCloudState(uid, NS, state); return { status: "stopped_by_kill_switch", observedAt: state.lastCycleAt, deliveries: [], productionChanged: false }; }
    const controller = await runRevenueControllerCycle(uid).catch(async () => revenueControllerStatus(uid));
    const approvals = await listApprovals(uid, { status: "pending", limit: 100 });
    const incidents = currentIncidents(controller);
    const deliveries = [];
    for (const incident of incidents) {
      const key = fingerprint(incident.type, stableIncidentEvidence(incident.evidence));
      const event = await enqueueEvent({ userId: uid, type: `background.${incident.type}`, title: incident.title, body: incident.detail, priority: "urgent", dedupeKey: key, data: { ...incident.evidence, authority: "observe_notify" } });
      deliveries.push(await deliver({ subject: `[CRITICAL] ${incident.title}`, text: `${incident.detail}\n\nEvidence: ${JSON.stringify(incident.evidence)}\n\nGeorgie made no consequential change.`, key: `critical:${key}`, state, critical: true }));
      if (event) state.incidents.push({ ...incident, id: event.id, fingerprint: key, createdAt: event.createdAt });
    }
    for (const approval of approvals) deliveries.push(await deliver({ subject: `[APPROVAL NEEDED] ${approval.title}`, text: `${approval.summary}\n\nApproval ID: ${approval.id}\nRisk: ${approval.risk}\nReversible: ${approval.reversible ? "yes" : "no"}\n\nReview inside Georgie. This notice does not execute the action.`, key: `approval:${approval.id}`, state, critical: false }));
    const window = notificationWindow(at);
    if (window.dailyBriefDue && state.lastDailyBriefDay !== window.day) {
      const delivery = await deliver({ subject: `Sierra Daily Control Brief — ${window.day}`, text: briefText(controller, approvals, incidents), key: `daily:${window.day}`, state, critical: false });
      deliveries.push(delivery); if (delivery.status === "delivered") state.lastDailyBriefDay = window.day;
    }
    const deliveredEntries = Object.entries(state.delivered || {}).sort((a, b) => String(b[1]?.at || "").localeCompare(String(a[1]?.at || ""))).slice(0, 2000);
    state.delivered = Object.fromEntries(deliveredEntries); state.lastCycleAt = now(); state.cycles = Number(state.cycles || 0) + 1; state.incidents = state.incidents.slice(-500); state.updatedAt = now();
    await writeCloudState(uid, NS, state);
    return { status: "completed", mode: state.mode, observedAt: state.lastCycleAt, killSwitchObserved: killed, controller: controller.coverage || {}, incidentCount: incidents.length, pendingApprovals: approvals.length, deliveries, productionChanged: false };
  } finally { running = false; }
}
export function startBackgroundOperatingLayer() {
  if (timer || process.env.NODE_ENV === "test" || process.env.GEORGIE_BACKGROUND_OPERATING_ENABLED === "false") return timer;
  const execute = () => runBackgroundOperatingCycle().catch((error) => console.warn("Background operating cycle delayed:", error instanceof Error ? error.message : error));
  setTimeout(execute, 15_000).unref?.(); timer = setInterval(execute, INTERVAL); timer.unref?.(); return timer;
}
