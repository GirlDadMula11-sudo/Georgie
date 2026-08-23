const SPECIALISTS=Object.freeze([
  {id:"infra-engineer",role:"infrastructure_engineer",domains:["technical"],capabilities:["repository_inspection","code_review","patch_preparation","deployment_diagnostics","infrastructure_health","architecture"]},
  {id:"sierra-operator",role:"sierra_operations",domains:["sierra"],capabilities:["sierra_health","crm_workflows","intake","reconciliation","operational_diagnostics"]},
  {id:"capitalmatch-analyst",role:"capitalmatch_underwriting",domains:["sierra"],capabilities:["underwriting","capitalmatch","lender_reasoning","deal_evidence"]},
  {id:"document-worker",role:"document_cm100",domains:["sierra"],capabilities:["document_intake","document_transition","cm100","artifact_verification"]},
  {id:"outreach-worker",role:"outreach_operations",domains:["sierra"],capabilities:["smartlead","campaigns","deliverability","outreach_metrics"]},
  {id:"monitoring-worker",role:"monitoring_recovery",domains:["technical","sierra","general"],capabilities:["monitoring","recovery","evidence_persistence","background_recovery"]},
  {id:"research-worker",role:"research",domains:["technical","sierra","general"],capabilities:["research","comparison","evidence_collection"]}
]);

const text=value=>String(value||"").toLowerCase();
export function listSpecialists(){return SPECIALISTS.map(item=>structuredClone(item));}

export function classifySpecialistNeeds(input={}){
  const body=text(input.text||input.instruction),domain=input.domain||"general",needed=[];
  if(/repo|code|deploy|render|vercel|github|architecture|worker|runtime|migration/.test(body))needed.push("repository_inspection");
  if(/intake|crm|application|reconcil|submission/.test(body))needed.push("sierra_health");
  if(/capitalmatch|underwriting|lender|offer|funding/.test(body))needed.push("capitalmatch");
  if(/document|cm[- ]?100|statement|attachment|artifact/.test(body))needed.push("document_intake");
  if(/smartlead|campaign|outreach|deliverability|bounce|click/.test(body))needed.push("smartlead");
  if(/monitor|recover|retry|health|incident|stuck|timeout/.test(body))needed.push("monitoring");
  if(/research|compare|investigat|evidence/.test(body))needed.push("research");
  return {domain,requiredCapabilities:[...new Set(needed)]};
}

export function selectSpecialist(input={}){
  const {domain,requiredCapabilities}=classifySpecialistNeeds(input);
  const scored=SPECIALISTS.map(worker=>({worker,score:(worker.domains.includes(domain)?2:0)+requiredCapabilities.reduce((n,c)=>n+(worker.capabilities.includes(c)?3:0),0)})).sort((a,b)=>b.score-a.score||a.worker.id.localeCompare(b.worker.id));
  const winner=scored[0];
  return {specialist:structuredClone(winner.worker),requiredCapabilities,score:winner.score,reason:winner.score?"best capability/domain match":"general fallback"};
}
