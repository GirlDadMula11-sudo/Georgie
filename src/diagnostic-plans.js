import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { summarizeInvestigationSteps } from "./evidence-foundation.js";

const NAMESPACE = "sierra_diagnostic_investigations", MAX_PLANS = 40;
const DEFAULT_TOOLS = ["sierra.health", "sierra.infrastructure", "sierra.apply_inventory", "sierra.reconciliation_invariant", "sierra.portfolio", "sierra.guarded_conflict_intelligence"];
const ALLOWED_TOOLS = new Set([...DEFAULT_TOOLS, "sierra.deal", "sierra.document_manifest", "sierra.audit_events", "sierra.lenders", "sierra.offers", "sierra.evidence_graph", "sierra.deal_workspace", "sierra.governed_access", "sierra.strategy", "sierra.network_gaps"]);
function bounded(value) { const serialized = JSON.stringify(value ?? null); return serialized.length > 150000 ? { bounded: true, byteLength: serialized.length, summary: "Result retained by source contract; synthesis bounded." } : value; }
export function normalizeDiagnosticState(value) { return { ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}), version: Number(value?.version) || 1, plans: Array.isArray(value?.plans) ? value.plans.filter(item => item && typeof item === "object") : [] }; }
async function state(userId) { return normalizeDiagnosticState(await readCloudState(userId, NAMESPACE, { version: 1, plans: [] })); }
async function save(userId, next) { const normalized = normalizeDiagnosticState(next); const saved = await writeCloudState(userId, NAMESPACE, { version: 1, updatedAt: new Date().toISOString(), plans: normalized.plans.slice(0, MAX_PLANS) }); if (!saved) throw new Error("Durable diagnostic-state storage is unavailable"); }
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

function containsUnresolved(value,depth=0){
  if(depth>7)return false;
  if(typeof value==="string")return /\b(?:not returned|unknown|unavailable)\b/i.test(value);
  if(Array.isArray(value))return value.some(item=>containsUnresolved(item,depth+1));
  if(value&&typeof value==="object")return Object.entries(value).some(([key,item])=>/unknowns?|evidenceGaps?/i.test(key)?(Array.isArray(item)?item.length>0:Boolean(item)):containsUnresolved(item,depth+1));
  return false;
}

export async function continueDurableDiagnosticPlan(userId,{reference,scope="deal_continuation",freshnessMs=300000,tools=null}={},execute){
  if(!reference)throw new Error("A target deal or merchant is required for a continued Sierra investigation");
  const required=Array.isArray(tools)&&tools.length?tools:["sierra.deal","sierra.document_manifest","sierra.evidence_graph","sierra.deal_workspace","sierra.lenders","sierra.infrastructure","sierra.reconciliation_invariant"];
  const current=await state(userId),now=Date.now();
  const prior=current.plans.find(plan=>String(plan.reference||"").toLowerCase()===String(reference).toLowerCase());
  const reusable=new Map((prior?.steps||[]).filter(step=>step.status==="completed"&&step.completedAt&&now-new Date(step.completedAt).getTime()<=Math.max(0,Number(freshnessMs)||0)).map(step=>[step.tool,step]));
  const toRun=required.filter(tool=>!reusable.has(tool));
  if(!toRun.length){
    const requestId=crypto.randomUUID(),timestamp=new Date().toISOString();
    const steps=required.map((tool,index)=>({...reusable.get(tool),stepId:`${requestId}:${index+1}`,reusedFromRequestId:prior?.requestId||null,reusedFreshEvidence:true}));
    const synthesis=summarizeInvestigationSteps(steps),plan={requestId,version:Number(prior?.version||0)+1,scope,reference,mode:"read_only",status:"completed",createdAt:timestamp,startedAt:timestamp,completedAt:timestamp,steps,synthesis:{...synthesis,unresolved:[]},continuationOf:prior?.requestId||null,skippedFreshTools:[...reusable.keys()],writesPerformed:false};
    await save(userId,{...current,plans:[plan,...current.plans]});return plan;
  }
  const plan=await runDurableDiagnosticPlan(userId,{reference,scope,tools:toRun},execute);
  const executed=new Map(plan.steps.map(step=>[step.tool,step]));
  plan.steps=required.map((tool,index)=>{
    const fresh=executed.get(tool);if(fresh)return fresh;
    const reused=reusable.get(tool);return{...reused,stepId:`${plan.requestId}:${index+1}`,reusedFromRequestId:prior?.requestId||null,reusedFreshEvidence:true};
  });
  plan.continuationOf=prior?.requestId||null;
  plan.skippedFreshTools=[...reusable.keys()];
  plan.synthesis=summarizeInvestigationSteps(plan.steps);
  const unresolved=plan.steps.filter(step=>step.status!=="completed"||containsUnresolved(step.result)).map(step=>({tool:step.tool,reason:step.status!=="completed"?(step.error||step.status):"required evidence contains an explicit unknown or not-returned value"}));
  plan.synthesis.unresolved=unresolved;
  plan.status=unresolved.length?"blocked_incomplete_evidence":"completed";
  plan.completedAt=new Date().toISOString();
  const latest=await state(userId);await save(userId,{...latest,plans:[plan,...latest.plans.filter(item=>item.requestId!==plan.requestId)]});
  return plan;
}
