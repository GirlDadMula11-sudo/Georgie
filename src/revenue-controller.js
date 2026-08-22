import { readCloudState, writeCloudState } from "./cloud-state.js";
import { getSierraHealth, getSierraInfrastructure, getSierraPortfolio, getSierraReconciliationInvariant, sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";

const NS="revenue_controller_v1";
const USER=()=>process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const INTERVAL=Math.max(60_000,Number(process.env.GEORGIE_REVENUE_CONTROLLER_INTERVAL_MS||5*60_000));
let timer=null,running=false;

export const REVENUE_PHASES=Object.freeze([
  {id:1,name:"Deal-flow control",status:"active",purpose:"Assign Georgie to every active deal, rank the earliest blocker, protect processing, and carry each package to the lender-approval boundary."},
  {id:2,name:"Conversion and attribution",status:"locked",purpose:"Prove every source-to-funded handoff and repair conversion leakage before expanding demand."},
  {id:3,name:"Controlled traffic growth",status:"locked",purpose:"Scale SEO, content, partners, referrals, and healthy campaigns only after capacity and attribution gates pass."}
]);

const dealsFrom=value=>Array.isArray(value)?value:Array.isArray(value?.deals)?value.deals:Array.isArray(value?.items)?value.items:[];
const count=(rows,predicate)=>rows.filter(predicate).length;
export function buildRevenueControllerSnapshot({portfolio=[],health={},infrastructure={},reconciliation={},observedAt=new Date().toISOString()}={}){
  const deals=dealsFrom(portfolio),assignments=deals.map(deal=>({
    reference:deal.reference_number||deal.reference||deal.referral_id||"unknown",business:deal.legal_business_name||"Business name unavailable",stage:deal.current_stage||deal.referral_status||"unknown",state:deal.stage_status||"unknown",attention:deal.attention_level||"normal",attentionScore:Number(deal.attention_score||0),nextAction:deal.next_action||"Inspect the earliest unverified handoff",approvalRequired:/jason|louri|select lender|approval/i.test(String(deal.next_action||"")),systemWaiting:deal.stage_status==="waiting_system",humanWaiting:deal.stage_status==="waiting_human",submitted:Number(deal.submitted_lender_count||0),offers:Number(deal.available_offers||0),evidenceCoverage:Number(deal.evidence_coverage_score||0),underwritingCompleteness:Number(deal.underwriting_completeness||0),updatedAt:deal.deal_updated_at||null
  })).sort((a,b)=>b.attentionScore-a.attentionScore||Number(b.approvalRequired)-Number(a.approvalRequired));
  const metrics=health?.metrics||{},core=infrastructure?.sierra_core||{};
  return{version:1,mode:"progressive",active:true,phase:1,phaseName:"Deal-flow control",observedAt,objective:"Drive durable, compliant Sierra revenue by increasing qualified demand, conversion, completed packages, approvals, funded volume, retention, and partner production while protecting every revenue-system handoff.",phases:REVENUE_PHASES,coverage:{assignedDeals:assignments.length,waitingSystem:count(assignments,row=>row.systemWaiting),waitingHuman:count(assignments,row=>row.humanWaiting),lenderSubmitted:count(assignments,row=>row.submitted>0),offersAvailable:assignments.reduce((sum,row)=>sum+row.offers,0)},controls:{pipelineFailures:Number(metrics.failed_pipeline_stages||0),staleAutomation:Number(core.stale_automation||0),reconciliationExceptions:Number(reconciliation?.exceptions??-1),reconciliationProven:reconciliation?.completeness_proven===true&&reconciliation?.authoritative_capitalapply_pass===true&&reconciliation?.sierra_observed_pass===true},gates:{externalCommunication:"approval_required",lenderSubmission:"approval_required",financialAction:"approval_required",credentials:"approval_required",destructiveChange:"approval_required",safeCertifiedMaintenance:"automatic_with_verification"},assignments};
}

export async function revenueControllerStatus(userId=USER()){return readCloudState(String(userId),NS,{version:1,mode:"progressive",active:false,phase:0,phaseName:"Not activated",phases:REVENUE_PHASES,assignments:[],coverage:{assignedDeals:0}});}
export async function runRevenueControllerCycle(userId=USER()){
  if(running)return{skipped:true,reason:"cycle_already_running"};running=true;const uid=String(userId||USER());
  try{const prior=await revenueControllerStatus(uid);if(!prior.active)return{...prior,skipped:true,reason:"controller_not_active"};if(!sierraWorkforceConfigured())throw new Error("Sierra Workforce is not configured");const[portfolio,health,infrastructure,reconciliation]=await Promise.all([getSierraPortfolio(uid,{limit:100}),getSierraHealth(uid),getSierraInfrastructure(uid),getSierraReconciliationInvariant(uid,{limit:250})]);const snapshot=buildRevenueControllerSnapshot({portfolio,health,infrastructure,reconciliation}),state={...prior,...snapshot,activatedAt:prior.activatedAt||snapshot.observedAt,lastCycleAt:snapshot.observedAt,cycles:Number(prior.cycles||0)+1};await writeCloudState(uid,NS,state);return state;}finally{running=false;}
}
export async function activateRevenueController(userId=USER()){const uid=String(userId||USER()),prior=await revenueControllerStatus(uid),at=new Date().toISOString();await writeCloudState(uid,NS,{...prior,version:1,mode:"progressive",active:true,phase:1,phaseName:"Deal-flow control",phases:REVENUE_PHASES,activatedAt:prior.activatedAt||at,updatedAt:at});return runRevenueControllerCycle(uid);}
export function startRevenueController(){if(process.env.GEORGIE_REVENUE_CONTROLLER_ENABLED==="false"||timer)return timer;void runRevenueControllerCycle().catch(error=>console.warn("Revenue controller cycle failed:",error instanceof Error?error.message:error));timer=setInterval(()=>void runRevenueControllerCycle().catch(error=>console.warn("Revenue controller cycle failed:",error instanceof Error?error.message:error)),INTERVAL);timer.unref?.();return timer;}
