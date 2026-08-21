import crypto from "node:crypto";
import { operatingContinuity, upsertOperatingNode } from "./operating-graph.js";
import { readWorldStateSnapshot } from "./world-state-sentinel.js";

const bounded = (value, max = 2000) => String(value || "").trim().slice(0, max);

export function interpretOperatingObjective(input = "") {
  const text = bounded(input, 6000);
  const lower = text.toLowerCase();
  const continuation = /\b(continue|resume|pick up|finish|complete the remaining|keep (?:going|working|attacking))\b/.test(lower);
  const approval = /\b(approve|approved|you have my approval|authorized|go ahead|complete it|fix it)\b/.test(lower);
  const inspection = /\b(inspect|diagnos|audit|review|check|analy[sz]e|find out|what(?:'s| is) wrong)\b/.test(lower);
  const execution = /\b(fix|repair|implement|build|change|update|restart|deploy|send|submit|reconcile|complete)\b/.test(lower);
  const engineering = /\b(repo(?:sitory)?|code(?:base)?|commit|push|deploy|migration|test suite|worker|runtime|architecture)\b/.test(lower);
  const domain = /\b(sierra|deal|application|lender|capitalmatch|underwriting|smartlead|campaign)\b/.test(lower) ? "sierra" : engineering ? "technical" : "general";
  const kind = engineering ? "engineering" : inspection ? "investigation" : execution ? "execution" : "objective";
  const fingerprint = crypto.createHash("sha256").update(`${domain}:${kind}:${lower.replace(/\s+/g, " ")}`).digest("hex").slice(0, 24);
  return { text, domain, kind, continuation, approval, inspection, execution, stableKey: `objective:${fingerprint}`, requiresTools: inspection || execution || engineering, consequencePossible: /\b(send|submit|payment|charge|delete|destructive|production|external|lender)\b/.test(lower) };
}

export function runtimeToolReadiness(surface = {}) {
  const tools = Array.isArray(surface?.tools) ? surface.tools : [];
  const attached = tools.filter((tool) => tool.attached !== false);
  const configured = attached.filter((tool) => tool.configured !== false);
  return { mode: surface?.mode || "persistent_governed_registry", attachedToEveryTurn: surface?.attachedToEveryTurn === true, registered: tools.length, attached: attached.length, configured: configured.length, blocked: attached.filter((tool) => tool.configured === false).map((tool) => ({ tool: tool.name, precondition: tool.precondition || "configuration_required" })) };
}

export async function prepareUnifiedOperatingTurn({ userId = "primary", sessionId = "native", input = "" } = {}) {
  const objective = interpretOperatingObjective(input);
  const { getCapabilityManifest } = await import("./capability-manifest.js");
  const capabilityManifest = getCapabilityManifest();
  const { persistentToolSurface } = await import("./tools.js");
  const toolSurface = persistentToolSurface();
  const [continuity, worldState] = await Promise.all([
    operatingContinuity(userId, { limit: 30 }).catch((error) => ({ unavailable: true, error: error instanceof Error ? error.message : String(error), activeNodes: [], nextActions: [] })),
    readWorldStateSnapshot(userId).catch((error) => ({ unavailable: true, error: error instanceof Error ? error.message : String(error) })),
  ]);
  const eligibleContinuation = objective.continuation ? (continuity?.activeNodes || []).find((node) => node.domain === objective.domain || objective.domain === "general") || null : null;
  return { version: "unified-georgie-runtime.v1", preparedAt: new Date().toISOString(), userId: String(userId), sessionId: String(sessionId), objective, eligibleContinuation, continuity, worldState, capabilityManifest, toolSurface: runtimeToolReadiness(toolSurface), executionContract: { loop: ["understand", "plan", "act", "verify", "recover", "report", "learn"], streamProgressImmediately: true, preserveServerWorkAfterDisconnect: true, requireBusinessOutcomeEvidence: true, terminalStates: ["completed", "blocked", "approval_needed", "in_progress"], consequentialActionsApprovalGated: true } };
}

export async function retainUnifiedObjective(userId, envelope, outcome = {}) {
  if (!envelope?.objective?.text) return null;
  const terminal = outcome?.terminalState || (outcome?.completed === false ? "recovering" : "verified");
  const status = ["completed", "verified"].includes(terminal) ? "verified" : terminal === "blocked" ? "blocked" : terminal === "approval_needed" ? "waiting" : "recovering";
  return upsertOperatingNode(userId, { stableKey: envelope.objective.stableKey, kind: envelope.objective.kind, title: envelope.objective.text.slice(0, 240), description: "Retained by the Unified Georgie Operating Runtime.", domain: envelope.objective.domain, status, priority: status === "blocked" || status === "recovering" ? "high" : "normal", nextAction: status === "verified" ? "" : "Continue from retained evidence; rerun only missing or stale work and report the exact terminal outcome.", verification: status === "verified" ? bounded(outcome?.text, 1200) : "", recovery: status === "recovering" ? "Resume durable work without duplicating completed actions." : "", evidenceRefs: Array.isArray(outcome?.evidence) ? outcome.evidence.map((item) => `tool:${item.source}`).slice(0, 30) : [] });
}

export function unifiedRuntimePrompt(envelope) {
  return `UNIFIED GEORGIE OPERATING RUNTIME\n${JSON.stringify({ version: envelope.version, objective: envelope.objective, eligibleContinuation: envelope.eligibleContinuation, continuity: envelope.continuity, worldState: envelope.worldState, toolSurface: envelope.toolSurface, executionContract: envelope.executionContract }).slice(0, 16000)}\nUse ordinary-language intent, continue eligible durable work, never claim a configured attached tool is absent, identify its exact failed precondition if execution fails, and report checked/found/changed/verified/remaining with one explicit terminal state.`;
}
