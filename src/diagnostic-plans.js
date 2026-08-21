import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { summarizeInvestigationSteps } from "./evidence-foundation.js";

const NAMESPACE = "sierra_diagnostic_investigations", MAX_PLANS = 40;
const DEFAULT_TOOLS = ["sierra.health", "sierra.infrastructure", "sierra.apply_inventory", "sierra.reconciliation_invariant", "sierra.portfolio", "sierra.guarded_conflict_intelligence"];
const ALLOWED_TOOLS = new Set([...DEFAULT_TOOLS, "sierra.deal", "sierra.document_manifest", "sierra.audit_events", "sierra.lenders", "sierra.offers", "sierra.evidence_graph", "sierra.governed_access", "sierra.strategy", "sierra.network_gaps"]);
function bounded(value) { const serialized = JSON.stringify(value ?? null); return serialized.length > 150000 ? { bounded: true, byteLength: serialized.length, summary: "Result retained by source contract; synthesis bounded." } : value; }
async function state(userId) { return readCloudState(userId, NAMESPACE, { version: 1, plans: [] }); }
async function save(userId, next) { const saved = await writeCloudState(userId, NAMESPACE, { version: 1, updatedAt: new Date().toISOString(), plans: next.plans.slice(0, MAX_PLANS) }); if (!saved) throw new Error("Durable diagnostic-state storage is unavailable"); }
export async function listDiagnosticPlans(userId, { limit = 20 } = {}) { const current = await state(userId); return current.plans.slice(0, Math.max(1, Math.min(Number(limit) || 20, MAX_PLANS))); }

export async function runDurableDiagnosticPlan(userId, { reference = null, scope = "sierra_end_to_end", tools = null } = {}, execute) {
  if (typeof execute !== "function") throw new Error("Diagnostic executor is unavailable");
  const requestedTools = Array.isArray(tools) && tools.length ? tools : [...DEFAULT_TOOLS, ...(reference ? ["sierra.deal", "sierra.document_manifest", "sierra.audit_events", "sierra.lenders", "sierra.offers", "sierra.evidence_graph"] : [])];
  const uniqueTools = [...new Set(requestedTools)].filter(tool => ALLOWED_TOOLS.has(tool)).slice(0, 20), requestId = crypto.randomUUID(), now = new Date().toISOString();
  if (!uniqueTools.length) throw new Error("The requested diagnostic plan contains no approved read-only Sierra contracts");
  const plan = { requestId, version: 1, scope, reference, mode: "read_only", status: "running", createdAt: now, startedAt: now, completedAt: null, steps: uniqueTools.map((tool, index) => ({ stepId: `${requestId}:${index + 1}`, tool, args: reference ? { reference } : {}, status: "pending", startedAt: null, completedAt: null, result: null, error: null })), synthesis: null, writesPerformed: false };
  const current = await state(userId); await save(userId, { ...current, plans: [plan, ...current.plans] });
  await Promise.all(plan.steps.map(async step => {
    step.status = "running"; step.startedAt = new Date().toISOString();
    try { const outcome = await execute(step.tool, step.args); if (!outcome?.ok) throw new Error(outcome?.error || `${step.tool} returned no verified result`); step.status = "completed"; step.result = bounded(outcome.result); }
    catch (error) { step.status = "failed"; step.error = error instanceof Error ? error.message : String(error); }
    finally { step.completedAt = new Date().toISOString(); const latest = await state(userId), existing = latest.plans.find(item => item.requestId === requestId) || plan; existing.steps = plan.steps; existing.status = plan.steps.some(item => ["pending", "running"].includes(item.status)) ? "running" : plan.steps.some(item => item.status === "completed") ? "partial" : "failed"; await save(userId, { ...latest, plans: [existing, ...latest.plans.filter(item => item.requestId !== requestId)] }); }
  }));
  plan.synthesis = summarizeInvestigationSteps(plan.steps); plan.status = plan.synthesis.failed === 0 ? "completed" : plan.synthesis.completed > 0 ? "partial" : "failed"; plan.completedAt = new Date().toISOString();
  const latest = await state(userId); await save(userId, { ...latest, plans: [plan, ...latest.plans.filter(item => item.requestId !== requestId)] }); return plan;
}
