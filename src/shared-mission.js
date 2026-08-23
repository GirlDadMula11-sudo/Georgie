import crypto from "node:crypto";
import { cloudStateStatus, readCloudState, writeCloudState } from "./cloud-state.js";

const NS="shared_engineering_mission_v1";
const USER=()=>process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const LEASE_MS=Math.max(60_000,Number(process.env.GEORGIE_ENGINEERING_LEASE_MS||10*60_000));
const MAX_ATTEMPTS=Math.max(1,Number(process.env.GEORGIE_ENGINEERING_MAX_ATTEMPTS||5));
const now=()=>new Date().toISOString();
const localStates=new Map(),mutationChains=new Map();
function serialized(userId,work){const key=String(userId||USER()),prior=mutationChains.get(key)||Promise.resolve();const run=prior.catch(()=>{}).then(work);mutationChains.set(key,run.catch(()=>{}));return run;}

export const SHARED_MISSION=Object.freeze({
  id:"jason-sierra-operating-mission",
  version:2,
  objective:"Keep Sierra, CapitalMatch, Georgie, and Jason's authorized personal plans reliable, fast, evidence-backed, understandable, and continuously improving while protecting production data, private information, and customer trust.",
  priorities:[
    "Restore and preserve core CRM, authentication, database, queue, worker, and deployment stability.",
    "Reconcile document identity and lineage across intake, CRM, CM-100, and lender packages.",
    "Prove CM-100 storage, registration, readability, attachment, and readiness gates.",
    "Repair statement metadata and reject ambiguous, duplicate, or overlapping periods.",
    "Certify Partner Portal and CapitalApply parity, speed, and transfer integrity.",
    "Prove lender packages exclude superseded, rejected, and quarantined evidence.",
    "Reconcile authoritative lender-linked outcomes before evaluating or retraining CapitalMatch.",
    "Preserve exactly-once communications and clear partner, client, lender, and executive updates.",
    "Expand revenue work only after the underlying evidence and delivery paths are certified.",
    "Support authorized personal plans without crossing business, household, privacy, communication, or financial authority boundaries."
  ],
  authority:{
    automatic:["observe","diagnose","research","reproduce","run_tests","capture_evidence","create_handoff","post_internal_handoff_receipt","retry_temporary_failure","execute_certified_reversible_runbook","commit_verified_patch_to_isolated_branch"],
    approvalRequired:["merge_to_main","production_deploy","database_or_schema_mutation","credential_or_auth_change","external_business_communication","lender_submission","financial_action","destructive_or_irreversible_action"],
    prohibited:["weaken_authentication","disable_integrity_controls","fabricate_evidence","silently_change_customer_or_lender_data","learn_from_quarantined_or_uncertain_outcomes"]
  },
  completionStandard:"A task is complete only when its acceptance criteria pass against current authoritative evidence and the result is durably recorded."
});

function defaultState(){return{version:2,active:true,mission:SHARED_MISSION,items:[],receipts:[],lastCycleAt:null,createdAt:now(),updatedAt:now()};}
function bounded(value,max=4000){return String(value||"").trim().slice(0,max);}
function fingerprint(item){return crypto.createHash("sha256").update(JSON.stringify({objective:item.objective,type:item.type,scope:item.scope||null,source:item.source||null})).digest("hex").slice(0,32);}
function normalize(input={}){
  const objective=bounded(input.objective,4000);if(!objective)throw new Error("A handoff objective is required");
  const type=["investigation","engineering","verification","certified_repair","capability_gap"].includes(input.type)?input.type:"engineering";
  return{objective,type,source:bounded(input.source||"georgie",100),priority:Math.max(1,Math.min(100,Number(input.priority)||50)),scope:input.scope&&typeof input.scope==="object"?input.scope:{},dependsOn:Array.isArray(input.dependsOn)?[...new Set(input.dependsOn.map(v=>bounded(v,200)).filter(Boolean))].slice(0,20):[],acceptanceCriteria:Array.isArray(input.acceptanceCriteria)?input.acceptanceCriteria.map(v=>bounded(v,1000)).filter(Boolean).slice(0,30):[],evidence:input.evidence&&typeof input.evidence==="object"?input.evidence:{},requestedAuthority:bounded(input.requestedAuthority||"automatic_safe_work",100)};
}
export function autonomousRepairPolicy(input={}){
  const risk=String(input.risk||"").toLowerCase(),files=Array.isArray(input.files)?input.files.map(String):[],checks=Array.isArray(input.checks)?input.checks:[];
  const forbiddenFile=files.some(path=>/(^|\/)(migrations?|supabase|auth|payments?|credentials?|secrets?|render\.yaml)(\/|$)/i.test(path));
  const verified=checks.length>0&&checks.every(check=>check?.status==="passed");
  const reversible=input.reversible===true&&Boolean(input.rollbackPlan);
  const isolated=input.branch&&String(input.branch)!=="main";
  const boundedFiles=files.length>0&&files.length<=12;
  const eligible=["low","write"].includes(risk)&&verified&&reversible&&isolated&&boundedFiles&&!forbiddenFile&&input.customerDataChanged!==true&&input.externalSideEffect!==true;
  return{eligible,action:eligible?"commit_to_isolated_branch":"approval_required",requirements:{testsPassed:verified,reversible,isolatedBranch:isolated,boundedFiles,noProtectedFiles:!forbiddenFile,noCustomerDataChange:input.customerDataChanged!==true,noExternalSideEffect:input.externalSideEffect!==true},mergeToMain:false,productionDeploy:false};
}
async function save(userId,state){localStates.set(String(userId),structuredClone(state));await writeCloudState(String(userId),NS,state);}
export async function missionStatus(userId=USER()){const uid=String(userId),cloudEnabled=cloudStateStatus().enabled,state=cloudEnabled?await readCloudState(uid,NS,defaultState()):(localStates.get(uid)||defaultState());const normalized={...defaultState(),...state,mission:SHARED_MISSION};localStates.set(uid,structuredClone(normalized));return normalized;}
export function enqueueHandoff(userId=USER(),input={}){return serialized(userId,async()=>{
  const uid=String(userId||USER()),item=normalize(input),state=await missionStatus(uid),dedupeKey=bounded(input.dedupeKey||fingerprint(item),200);
  const existing=state.items.find(row=>row.dedupeKey===dedupeKey&&!['cancelled','quarantined'].includes(row.status));
  if(existing){const merged=[...new Set([...(existing.dependsOn||[]),...(item.dependsOn||[])])];if(JSON.stringify(merged)!==JSON.stringify(existing.dependsOn||[])){existing.dependsOn=merged;existing.updatedAt=now();state.updatedAt=now();await save(uid,state);}return{status:"deduplicated",item:structuredClone(existing)};}
  const created={id:crypto.randomUUID(),dedupeKey,...item,status:"queued",attempts:0,lease:null,createdAt:now(),updatedAt:now(),nextAttemptAt:null,lastError:null,result:null};
  state.items=[...state.items,created].slice(-2000);state.updatedAt=now();await save(uid,state);return{status:"queued",item:structuredClone(created)};
});}
function dispatchRank(item){return item?.source==="authorized_assistant_control_command"?1:0;}
export function compareHandoffPriority(a,b){return dispatchRank(b)-dispatchRank(a)||b.priority-a.priority||String(a.createdAt).localeCompare(String(b.createdAt));}
export async function listHandoffs(userId=USER(),{status="active",limit=100}={}){const state=await missionStatus(userId),items=state.items.filter(item=>status==="all"||(status==="active"?!["completed","cancelled","quarantined"].includes(item.status):item.status===status)).sort(compareHandoffPriority).slice(0,Math.max(1,Math.min(Number(limit)||100,500)));return{mission:state.mission,active:state.active,items,lastCycleAt:state.lastCycleAt};}
export function claimNextHandoff(userId=USER(),workerId="georgie-background"){return serialized(userId,async()=>{
  const uid=String(userId),state=await missionStatus(uid),at=Date.now();
  for(const item of state.items)if(item.status==="running"&&Date.parse(item.lease?.expiresAt||0)<=at)item.status="queued";
  const gatePassed=row=>(row.dependsOn||[]).every(key=>{const dependency=state.items.find(item=>item.dedupeKey===key);return dependency?.status==="completed"||(dependency?.status==="diagnosed"&&dependency?.result?.repairPlan?.reproducible===true);});
  for(const row of state.items){
    if(!["queued","blocked_by_dependency"].includes(row.status))continue;
    const passed=gatePassed(row);
    if(row.status==="queued"&&!passed){row.status="blocked_by_dependency";row.updatedAt=now();}
    else if(row.status==="blocked_by_dependency"&&passed){row.status="queued";row.updatedAt=now();}
  }
  const item=state.items.filter(row=>row.status==="queued"&&(!row.nextAttemptAt||Date.parse(row.nextAttemptAt)<=at)&&row.attempts<MAX_ATTEMPTS).sort(compareHandoffPriority)[0];
  if(!item){state.lastCycleAt=now();state.updatedAt=now();await save(uid,state);return null;}
  item.status="running";item.attempts+=1;item.lease={workerId:bounded(workerId,100),claimedAt:now(),expiresAt:new Date(at+LEASE_MS).toISOString()};item.updatedAt=now();state.lastCycleAt=now();state.updatedAt=now();await save(uid,state);return structuredClone(item);
});}
function settle(userId,id,update){return serialized(userId,async()=>{const uid=String(userId),state=await missionStatus(uid),item=state.items.find(row=>row.id===id);if(!item)return null;Object.assign(item,update,{lease:null,updatedAt:now()});state.receipts=[...state.receipts,{id:crypto.randomUUID(),handoffId:id,status:item.status,at:now(),summary:bounded(update.summary||update.lastError||"",1000)}].slice(-3000);state.updatedAt=now();await save(uid,state);return structuredClone(item);});}
export const completeHandoff=(userId,id,result={})=>settle(userId,id,{status:"completed",completedAt:now(),result,summary:result.summary||"Acceptance evidence recorded."});
export const deferHandoff=(userId,id,{status="waiting_for_capability",result={},summary=""}={})=>settle(userId,id,{status,result,summary});
export async function failHandoff(userId,id,error){const state=await missionStatus(userId),item=state.items.find(row=>row.id===id),attempts=Number(item?.attempts||0),terminal=attempts>=MAX_ATTEMPTS;return settle(userId,id,{status:terminal?"quarantined":"queued",lastError:bounded(error instanceof Error?error.message:error,2000),nextAttemptAt:terminal?null:new Date(Date.now()+Math.min(30*60_000,30_000*2**Math.max(0,attempts-1))).toISOString(),summary:terminal?"Repeated failure quarantined for review.":"Temporary failure scheduled for retry."});}