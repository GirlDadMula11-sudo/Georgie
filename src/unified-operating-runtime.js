import crypto from "node:crypto";
import { operatingContinuity, upsertOperatingNode } from "./operating-graph.js";
import { readWorldStateSnapshot } from "./world-state-sentinel.js";
import { appendEvidence, recordCallback } from "./coordination-control-plane.js";
import { routeIncomingCommand } from "./command-objective-router.js";

const bounded = (value, max = 2000) => String(value || "").trim().slice(0, max);

export function interpretOperatingObjective(input = "") {
  const text = bounded(input, 6000);
  const lower = text.toLowerCase();
  const continuation = /\b(continue|resume|pick up|finish|complete the remaining|keep (?:going|working|attacking))\b/.test(lower);
  const approval = /\b(approve|approved|you have my approval|authorized|go ahead|complete it|fix it)\b/.test(lower);
  const inspection = /\b(inspect|diagnos|audit|review|check|analy[sz]e|find out|what(?:'s| is) wrong)\b/.test(lower);
  const execution = /\b(fix|repair|implement|build|change|update|restart|deploy|send|submit|reconcile|complete)\b/.test(lower);
  const engineering = /\b(repo(?:sitory)?|code(?:base)?|commit|push|deploy|migration|test suite|worker|runtime|architecture|control plane|handoff|coordination)\b/.test(lower);
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
  const [continuity, worldState, routing] = await Promise.all([
    operatingContinuity(userId, { limit: 30 }).catch((error) => ({ unavailable: true, error: error instanceof Error ? error.message : String(error), activeNodes: [], nextActions: [] })),
    readWorldStateSnapshot(userId).catch((error) => ({ unavailable: true, error: error instanceof Error ? error.message : String(error) })),
    routeIncomingCommand(userId,{...objective,title:objective.text,priority:objective.execution?80:60}).catch((error)=>({unavailable:true,error:error instanceof Error?error.message:String(error),objective:{objectiveId:null},command:null,handoff:null,specialist:null}))
  ]);
  const controlPlane=routing?.objective||routing;
  const eligibleContinuation = objective.continuation ? (continuity?.activeNodes || []).find((node) => node.domain === objective.domain || objective.domain === "general") || null : null;
  return { version: "unified-georgie-runtime.v3-specialist-routing", preparedAt: new Date().toISOString(), userId: String(userId), sessionId: String(sessionId), objective: {...objective,controlObjectiveId:controlPlane?.objectiveId||null}, eligibleContinuation, continuity, worldState, controlPlane, specialistRouting:{specialist:routing?.specialist||null,command:routing?.command||null,handoff:routing?.handoff||null}, capabilityManifest, toolSurface: runtimeToolReadiness(toolSurface), executionContract: { loop: ["understand", "plan", "route_specialist", "claim", "act", "verify", "publish_evidence", "handoff_or_report", "recover", "learn"], streamProgressImmediately: true, preserveServerWorkAfterDisconnect: true, requireBusinessOutcomeEvidence: true, commonObjectiveIds: true, immutableEvidenceReceipts: true, ownershipLeases: true, conflictLocks: true, typedCommandEnvelopes: true, specialistWorkers:true, resultCallbacks: "durable_pull_unless_endpoint_bound", terminalStates: ["completed", "blocked", "approval_needed", "in_progress"], consequentialActionsApprovalGated: true } };
}

export async function retainUnifiedObjective(userId, envelope, outcome = {}) {
  if (!envelope?.objective?.text) return null;
  const terminal = outcome?.terminalState || (outcome?.completed === false ? "recovering" : "verified");
  const status = ["completed", "verified"].includes(terminal) ? "verified" : terminal === "blocked" ? "blocked" : terminal === "approval_needed" ? "waiting" : "recovering";
  const node = await upsertOperatingNode(userId, { stableKey: envelope.objective.stableKey, kind: envelope.objective.kind, title: envelope.objective.text.slice(0, 240), description: "Retained by the Unified Georgie Operating Runtime and bound to the shared coordination control plane.", domain: envelope.objective.domain, status, priority: status === "blocked" || status === "recovering" ? "high" : "normal", nextAction: status === "verified" ? "" : "Continue from retained evidence; rerun only missing or stale work and report the exact terminal outcome.", verification: status === "verified" ? bounded(outcome?.text, 1200) : "", recovery: status === "recovering" ? "Resume durable work without duplicating completed actions." : "", evidenceRefs: Array.isArray(outcome?.evidence) ? outcome.evidence.map((item) => `tool:${item.source}`).slice(0, 30) : [] });
  const objectiveId=envelope?.controlPlane?.objectiveId||envelope?.objective?.controlObjectiveId;
  if(objectiveId){
    const evidence=Array.isArray(outcome?.evidence)?outcome.evidence:[];
    await Promise.all(evidence.slice(0,50).map((item,index)=>appendEvidence(userId,{objectiveId,source:item?.source||`runtime:${index+1}`,kind:item?.status||"runtime_evidence",claim:item?.claim||item?.summary||`Runtime evidence from ${item?.source||"tool"}`,refs:item?.sha256?[`sha256:${item.sha256}`]:[],metadata:{status:item?.status||null}}).catch(()=>null)));
    await recordCallback(userId,{objectiveId,from:"georgie",to:"chatgpt",type:"objective_outcome",status:status==="verified"?"verified":"available",summary:bounded(outcome?.text||`Objective ${status}`,3000),evidenceRefs:evidence.map(item=>`tool:${item?.source||"unknown"}`).slice(0,100),deliveryMode:"durable_pull"}).catch(()=>null);
  }
  return node;
}

export function unifiedRuntimePrompt(envelope) {
  return `UNIFIED GEORGIE OPERATING RUNTIME\n${JSON.stringify({ version: envelope.version, objective: envelope.objective, eligibleContinuation: envelope.eligibleContinuation, continuity: envelope.continuity, worldState: envelope.worldState, controlPlane: envelope.controlPlane, specialistRouting:envelope.specialistRouting, toolSurface: envelope.toolSurface, executionContract: envelope.executionContract }).slice(0,20000)}\nUse the shared control objective ID as the canonical work identity. Honor the assigned specialist and typed command envelope. Check existing leases, locks, commands, handoffs, and evidence before acting. Do not duplicate work already owned by another participant. Publish verified evidence and durable result callbacks. ChatGPT conversation callbacks are pull-based unless a separately configured endpoint exists. Use ordinary-language intent, continue eligible durable work, never claim a configured attached tool is absent, identify its exact failed precondition if execution fails, and report checked/found/changed/verified/remaining with one explicit terminal state.`;
}
