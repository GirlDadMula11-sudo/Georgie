import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { summarizeInvestigationSteps } from "./evidence-foundation.js";
import { persistInvestigationArtifact } from "./investigation-artifacts.js";

const NAMESPACE = "sierra_diagnostic_investigations", MAX_PLANS = 40;
const DEFAULT_TOOLS = ["sierra.health", "sierra.infrastructure", "sierra.apply_inventory", "sierra.reconciliation_invariant", "sierra.portfolio", "sierra.guarded_conflict_intelligence"];
const ALLOWED_TOOLS = new Set([...DEFAULT_TOOLS, "sierra.deal", "sierra.document_manifest", "sierra.document_intelligence", "sierra.document_certification", "sierra.audit_events", "sierra.lenders", "sierra.offers", "sierra.evidence_graph", "sierra.deal_workspace", "sierra.governed_access", "sierra.strategy", "sierra.network_gaps"]);
const INTAKE_TO_SUBMISSION_STAGES = new Set(["lead", "application", "documents", "underwriting", "capital_match", "lender_submission"]);
function bounded(value) { const serialized = JSON.stringify(value ?? null); return serialized.length > 150000 ? { bounded: true, byteLength: serialized.length, summary: "Result retained by source contract; synthesis bounded." } : value; }
export function normalizeDiagnosticState(value) { return { ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}), version: Number(value?.version) || 1, plans: Array.isArray(value?.plans) ? value.plans.filter(item => item && typeof item === "object") : [] }; }
async function state(userId) { return normalizeDiagnosticState(await readCloudState(userId, NAMESPACE, { version: 1, plans: [] })); }
async function save(userId, next) { const normalized = normalizeDiagnosticState(next); const plans=normalized.plans.slice(0,MAX_PLANS).map(plan=>({...plan,steps:(plan.steps||[]).map(({evidenceOutput,...step})=>step)}));const saved = await writeCloudState(userId, NAMESPACE, { version: 1, updatedAt: new Date().toISOString(), plans }); if (!saved) throw new Error("Durable diagnostic-state storage is unavailable"); }
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
    try { const outcome = await execute(step.tool, step.args); if (!outcome?.ok) throw new Error(outcome?.error || `${step.tool} returned no verified result`); step.status = "completed"; step.evidenceOutput=outcome.result;step.result = bounded(outcome.result); }
    catch (error) { step.status = "failed"; step.error = error instanceof Error ? error.message : String(error); }
    finally { step.completedAt = new Date().toISOString(); const latest = await state(userId), existing = latest.plans.find(item => item.requestId === requestId) || plan; existing.steps = plan.steps; existing.status = plan.steps.some(item => ["pending", "running"].includes(item.status)) ? "running" : plan.steps.some(item => item.status === "completed") ? "partial" : "failed"; await save(userId, { ...latest, plans: [existing, ...latest.plans.filter(item => item.requestId !== requestId)] }); }
  }));
  plan.synthesis = summarizeInvestigationSteps(plan.steps); plan.status = plan.synthesis.failed === 0 ? "completed" : plan.synthesis.completed > 0 ? "partial" : "failed"; plan.completedAt = new Date().toISOString();
  const latest = await state(userId); await save(userId, { ...latest, plans: [plan, ...latest.plans.filter(item => item.requestId !== requestId)] });
  const artifact=await persistInvestigationArtifact(userId,plan);
  plan.artifact={investigationId:artifact.investigationId,status:artifact.status,evidenceCoverage:artifact.evidenceCoverage,lifecycle:artifact.lifecycle,nextUndeliveredSection:artifact.sections.find(item=>item.status!=="delivered")?.id||null};
  if(!artifact.evidenceCoverage.readBackPassed)plan.status="blocked_incomplete_evidence";
  const committed=await state(userId);await save(userId,{...committed,plans:[plan,...committed.plans.filter(item=>item.requestId!==requestId)]});return plan;
}

export function unresolvedEvidencePaths(value,path="result",depth=0){
  if(depth>7)return[];
  if(typeof value==="string")return /\b(?:not returned|unknown|unavailable)\b/i.test(value)?[`${path}: ${value.slice(0,160)}`]:[];
  if(Array.isArray(value))return value.flatMap((item,index)=>unresolvedEvidencePaths(item,`${path}[${index}]`,depth+1)).slice(0,50);
  if(value&&typeof value==="object")return Object.entries(value).flatMap(([key,item])=>{
    const next=`${path}.${key}`;
    if(/unknowns?|evidenceGaps?/i.test(key)&&Array.isArray(item))return item.map((entry,index)=>`${next}[${index}]: ${typeof entry==="string"?entry:JSON.stringify(entry).slice(0,160)}`).slice(0,50);
    return unresolvedEvidencePaths(item,next,depth+1);
  }).slice(0,50);
  return[];
}

export function stageRequiredEvidencePaths(tool,value,scope="intake_to_submission"){
  const paths=unresolvedEvidencePaths(value);
  if(scope!=="intake_to_submission")return paths;
  if(tool==="sierra.evidence_graph"){
    const nodes=Array.isArray(value?.nodes)?value.nodes:[];
    return nodes.filter(node=>INTAKE_TO_SUBMISSION_STAGES.has(String(node?.stage||"").toLowerCase())).flatMap((node,index)=>unresolvedEvidencePaths(node,`result.nodes[${index}]`));
  }
  if(tool==="sierra.deal_workspace")return paths.filter(path=>!/(?:expectedEconomics|lenderFit|closing|funding|crm_accounting)/i.test(path));
  return paths;
}

function businessEvidenceGap(tool,path){
  const raw=String(path||"");
  if(/businessName|Business name/i.test(raw))return{missing:"Page-cited business name",why:"The application cannot be linked confidently to the canonical deal.",source:"Signed application",nextAction:"Re-extract the application and write its page-cited business name to the governed evidence ledger."};
  if(/jurisdiction/i.test(raw))return{missing:"Page-cited business jurisdiction",why:"Sierra cannot apply the correct three- or four-statement rule.",source:"Business address on the signed application",nextAction:"Extract the business state with its document ID, page, method, and confidence."};
  if(/cashFlowTrend|statement_metric|financialMetrics|bankStatements\.metrics/i.test(raw))return{missing:"Complete bank-statement metrics",why:"Underwriting and submission readiness cannot be verified without complete cash-flow calculations.",source:"Authoritative bank statements",nextAction:"Reprocess every statement and persist all required page-cited metrics."};
  if(/stableRecordId/i.test(raw))return{missing:"Stable record identifier",why:"Evidence cannot be joined or audited safely without a canonical record ID.",source:"Canonical Sierra application/document record",nextAction:"Repair the canonical record linkage; do not manufacture an identifier from OCR."};
  if(/sourceEvidence|provenance/i.test(raw))return{missing:"Source provenance",why:"The conclusion cannot be verified against an authoritative artifact.",source:"Evidence ledger and source document",nextAction:"Persist source artifact ID, page, extraction method, confidence, and version."};
  if(/\.state: unknown|unknownFields.*state/i.test(raw))return{missing:"Authoritative workflow state",why:"Sierra cannot prove that the required stage completed.",source:"Canonical workflow event",nextAction:"Read back the stage event and its timestamp after extraction completes."};
  return{missing:`Required evidence from ${tool}`,why:"A required intake-to-submission conclusion remains unsupported.",source:"Authoritative Sierra record",nextAction:"Read the cited missing path and repair only the verified source or extraction defect."};
}

function evidenceRepairProposal(reference,gaps,manifestStep){
  if(!gaps.length)return null;
  const manifest=manifestStep?.result;
  const hasDocuments=Boolean(manifest&&(Array.isArray(manifest)?manifest.length:Object.keys(manifest).length));
  if(!hasDocuments)return null;
  const extractionDefect=gaps.some(gap=>/(?:business name|jurisdiction|bank-statement metrics|source provenance)/i.test(gap.missing));
  if(!extractionDefect)return null;
  return{version:1,status:"approval_required",target:reference,execution:{tool:"sierra.reprocess_documents",args:{reference,reason:"Verified page-level application or statement extraction evidence is missing from the authoritative read-back."}},verification:[{tool:"sierra.document_certification",args:{reference}},{tool:"sierra.deal_workspace",args:{reference,refresh:false}}],scope:["existing application and bank statements only","governed extraction ledger writes","independent workspace read-back"],excluded:["lender submission","external communication","fabricating missing client documents","unrelated deal mutation"],success:"Certification and independent workspace read-back return the repaired evidence; otherwise the deal remains blocked."};
}

export function canonicalReferenceFromDeal(payload){
  const seen=new Set(),queue=[payload];
  while(queue.length){
    const value=queue.shift();if(!value||typeof value!=="object"||seen.has(value))continue;seen.add(value);
    for(const key of ["sca_reference","deal_reference","reference_number","referral_id","reference"]){const candidate=String(value[key]||"").trim();if(candidate&&(/^(?:SCA|CM)-/i.test(candidate)||key!=="reference"))return candidate;}
    for(const child of Object.values(value))if(child&&typeof child==="object")Array.isArray(child)?queue.push(...child):queue.push(child);
  }
  return null;
}

export async function continueDurableDiagnosticPlan(userId,{reference,scope="deal_continuation",freshnessMs=300000,tools=null}={},execute){
  if(!reference)throw new Error("A target deal or merchant is required for a continued Sierra investigation");
  const required=Array.isArray(tools)&&tools.length?tools:["sierra.deal","sierra.document_manifest","sierra.document_intelligence","sierra.evidence_graph","sierra.deal_workspace","sierra.document_certification","sierra.lenders","sierra.infrastructure","sierra.reconciliation_invariant"];
  const target=String(reference).trim();
  let resolvedReference=target,resolution="provided_reference";
  if(!/^(?:SCA|CM)-/i.test(target)){
    const lookup=await execute("sierra.deal",{reference:target});
    if(!lookup?.ok)throw new Error(`Could not resolve ${target} to a canonical Sierra deal: ${lookup?.error||"deal lookup returned no verified result"}`);
    resolvedReference=canonicalReferenceFromDeal(lookup.result)||target;
    resolution=resolvedReference===target?"provider_accepted_name_without_canonical_reference":"canonical_reference_resolved";
  }
  const current=await state(userId),now=Date.now();
  const prior=current.plans.find(plan=>[plan.reference,plan.target].some(value=>String(value||"").toLowerCase()===target.toLowerCase()||String(value||"").toLowerCase()===resolvedReference.toLowerCase()));
  const reusable=new Map((prior?.steps||[]).filter(step=>step.status==="completed"&&step.completedAt&&now-new Date(step.completedAt).getTime()<=Math.max(0,Number(freshnessMs)||0)).map(step=>[step.tool,step]));
  const toRun=required.filter(tool=>!reusable.has(tool));
  if(!toRun.length){
    const requestId=crypto.randomUUID(),timestamp=new Date().toISOString();
    const steps=required.map((tool,index)=>({...reusable.get(tool),stepId:`${requestId}:${index+1}`,reusedFromRequestId:prior?.requestId||null,reusedFreshEvidence:true}));
    const synthesis=summarizeInvestigationSteps(steps);
    const unresolved=steps.map(step=>({step,paths:stageRequiredEvidencePaths(step.tool,step.result,"intake_to_submission")})).filter(({step,paths})=>step.status!=="completed"||paths.length).map(({step,paths})=>({tool:step.tool,reason:step.status!=="completed"?(step.error||step.status):`required intake-to-submission evidence remains unresolved: ${paths.slice(0,8).join("; ")}`,paths}));
    const gapMap=new Map();for(const item of unresolved)for(const path of item.paths?.length?item.paths:[item.reason]){const gap=businessEvidenceGap(item.tool,path);gapMap.set(`${gap.missing}:${gap.source}`,gap);}
    synthesis.unresolved=unresolved;synthesis.businessGaps=[...gapMap.values()];synthesis.verifiedBreaks=synthesis.businessGaps.filter(gap=>/(?:Re-extract|Reprocess|Persist|Repair)/i.test(gap.nextAction));
    const plan={requestId,version:Number(prior?.version||0)+1,scope,reference:resolvedReference,target,resolution,mode:"read_only",status:unresolved.length?"blocked_incomplete_evidence":"completed",createdAt:timestamp,startedAt:timestamp,completedAt:timestamp,steps,synthesis,repairPlan:evidenceRepairProposal(resolvedReference,synthesis.businessGaps,steps.find(step=>step.tool==="sierra.document_manifest")),continuationOf:prior?.requestId||null,skippedFreshTools:[...reusable.keys()],writesPerformed:false};
    const artifact=await persistInvestigationArtifact(userId,plan);plan.artifact={investigationId:artifact.investigationId,status:artifact.status,evidenceCoverage:artifact.evidenceCoverage,lifecycle:artifact.lifecycle,nextUndeliveredSection:artifact.sections.find(item=>item.status!=="delivered")?.id||null};if(!artifact.evidenceCoverage.readBackPassed)plan.status="blocked_incomplete_evidence";
    await save(userId,{...current,plans:[plan,...current.plans]});return plan;
  }
  const plan=await runDurableDiagnosticPlan(userId,{reference:resolvedReference,scope,tools:toRun},execute);
  plan.target=target;plan.resolution=resolution;
  const executed=new Map(plan.steps.map(step=>[step.tool,step]));
  plan.steps=required.map((tool,index)=>{
    const fresh=executed.get(tool);if(fresh)return fresh;
    const reused=reusable.get(tool);return{...reused,stepId:`${plan.requestId}:${index+1}`,reusedFromRequestId:prior?.requestId||null,reusedFreshEvidence:true};
  });
  plan.continuationOf=prior?.requestId||null;
  plan.skippedFreshTools=[...reusable.keys()];
  plan.synthesis=summarizeInvestigationSteps(plan.steps);
  const unresolved=plan.steps.map(step=>({step,paths:stageRequiredEvidencePaths(step.tool,step.result,"intake_to_submission")})).filter(({step,paths})=>step.status!=="completed"||paths.length).map(({step,paths})=>({tool:step.tool,reason:step.status!=="completed"?(step.error||step.status):`required intake-to-submission evidence remains unresolved: ${paths.slice(0,8).join("; ")}`,paths}));
  plan.synthesis.unresolved=unresolved;
  const gapMap=new Map();
  for(const item of unresolved)for(const path of item.paths?.length?item.paths:[item.reason]){const gap=businessEvidenceGap(item.tool,path);gapMap.set(`${gap.missing}:${gap.source}`,gap);}
  plan.synthesis.businessGaps=[...gapMap.values()];
  plan.synthesis.verifiedBreaks=plan.synthesis.businessGaps.filter(gap=>/(?:Re-extract|Reprocess|Persist|Repair)/i.test(gap.nextAction));
  plan.repairPlan=evidenceRepairProposal(resolvedReference,plan.synthesis.businessGaps,plan.steps.find(step=>step.tool==="sierra.document_manifest"));
  plan.status=unresolved.length?"blocked_incomplete_evidence":"completed";
  plan.completedAt=new Date().toISOString();
  const artifact=await persistInvestigationArtifact(userId,plan);plan.artifact={investigationId:artifact.investigationId,status:artifact.status,evidenceCoverage:artifact.evidenceCoverage,lifecycle:artifact.lifecycle,nextUndeliveredSection:artifact.sections.find(item=>item.status!=="delivered")?.id||null};if(!artifact.evidenceCoverage.readBackPassed)plan.status="blocked_incomplete_evidence";
  const latest=await state(userId);await save(userId,{...latest,plans:[plan,...latest.plans.filter(item=>item.requestId!==plan.requestId)]});
  return plan;
}
