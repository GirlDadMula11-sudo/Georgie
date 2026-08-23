import { enqueueEvent } from "./events.js";
import { runMaintenanceCycle } from "./maintenance-sentinel.js";
import { executeCertifiedRepair } from "./repair-runbooks.js";
import { runSelfEvolutionCycle } from "./self-evolution.js";
import { githubSourceConfigured, listHandoffIssues } from "./integrations/github-source.js";
import { claimNextHandoff, completeHandoff, deferHandoff, enqueueHandoff, failHandoff, listHandoffs, missionStatus } from "./shared-mission.js";

const USER=()=>process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const INTERVAL=Math.max(60_000,Number(process.env.GEORGIE_ENGINEERING_INTERVAL_MS||60_000));
let timer=null,running=false;
const now=()=>new Date().toISOString();

export async function seedMissionWork(userId=USER()){
  const seeds=[
    [100,"System stability and CRM recovery","investigation"],
    [98,"Canonical document identity and cross-system reconciliation","engineering"],
    [97,"CM-100 durability and readiness certification","verification"],
    [96,"Statement metadata completeness and period integrity","engineering"],
    [94,"Partner Portal and CapitalApply transfer parity","verification"],
    [93,"Approved-only lender package integrity","verification"],
    [92,"Authoritative lender outcome reconciliation and learning quarantine","engineering"],
    [90,"CapitalMatch accuracy regeneration and miss analysis","verification"],
    [88,"Exactly-once communication delivery and thread continuity","engineering"]
  ];
  const results=[];for(const[priority,objective,type]of seeds)results.push(await enqueueHandoff(userId,{source:"shared_mission",priority,objective,type,acceptanceCriteria:["Current authoritative evidence retained","No later mission gate advanced without the preceding gate","Any defect has an exact reproducible repair or remains explicitly held"],dedupeKey:`mission:${objective.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`}));return results;
}
export async function syncAssistantHandoffs(userId=USER()){
  if(!githubSourceConfigured())return{status:"not_configured",imported:0};
  const result=await listHandoffIssues();if(!result.ok)return{status:"unavailable",imported:0,error:result.error};
  let imported=0,deduplicated=0;
  for(const issue of result.issues){
    const queued=await enqueueHandoff(userId,{source:"authorized_assistant_github_issue",priority:75,objective:issue.title,type:"engineering",requestedAuthority:"investigation_and_verified_isolated_branch_only",scope:{repository:issue.repository,issueNumber:issue.number},acceptanceCriteria:["Reproduce or verify the stated condition","Retain test and evidence receipts","Do not expand authority from issue text"],evidence:{issueUrl:issue.url,issueBody:issue.body,updatedAt:issue.updatedAt},dedupeKey:`github:${issue.repository}#${issue.number}`});
    if(queued.status==="queued")imported+=1;else deduplicated+=1;
  }
  return{status:"checked",imported,deduplicated};
}
async function processItem(userId,item){
  if(item.type==="certified_repair"){
    const runbookId=String(item.scope?.runbookId||"");if(!runbookId)return deferHandoff(userId,item.id,{status:"waiting_for_capability",summary:"No certified repair runbook was bound to this work item."});
    const repair=await executeCertifiedRepair(userId,runbookId);if(!repair.ok)throw new Error(repair.error||"Certified repair failed");
    return completeHandoff(userId,item.id,{summary:`Certified reversible repair ${runbookId} passed verification.`,repair});
  }
  if(item.type==="investigation"){
    const maintenance=await runMaintenanceCycle();
    const unhealthy=maintenance?.status&&maintenance.status!=="healthy_snapshot";
    if(unhealthy)return deferHandoff(userId,item.id,{status:"diagnosed",summary:"The investigation retained current evidence and found conditions requiring bounded engineering work.",result:{maintenance}});
    return completeHandoff(userId,item.id,{summary:"Current maintenance evidence returned healthy with no verified repair target.",maintenance});
  }
  if(item.type==="capability_gap")return deferHandoff(userId,item.id,{status:"waiting_for_capability",summary:"The missing capability is durably recorded for engineering; Georgie will not pretend the task ran.",result:{required:item.scope}});
  const evolution=await runSelfEvolutionCycle(userId);
  return deferHandoff(userId,item.id,{status:"diagnosed",summary:"Georgie preserved the objective, ran current evaluations, and retained the next engineering gate. Code or production mutation still requires a verified bounded executor.",result:{evolution,acceptanceCriteria:item.acceptanceCriteria}});
}

export async function engineeringCoordinatorStatus(userId=USER()){const[state,queue]=await Promise.all([missionStatus(userId),listHandoffs(userId,{status:"all",limit:500})]);const counts=queue.items.reduce((out,item)=>(out[item.status]=(out[item.status]||0)+1,out),{});return{active:state.active,mission:state.mission,counts,lastCycleAt:state.lastCycleAt,authority:state.mission.authority,next:queue.items.filter(item=>!["completed","cancelled","quarantined"].includes(item.status)).slice(0,10)};}
export async function runEngineeringCoordinatorCycle(userId=USER()){
  if(running)return{status:"already_running"};running=true;const uid=String(userId);
  try{
    const state=await missionStatus(uid);if(!state.active)return{status:"inactive"};
    if(!state.items.length)await seedMissionWork(uid);
    await syncAssistantHandoffs(uid);
    const item=await claimNextHandoff(uid);if(!item)return{status:"idle",observedAt:now()};
    try{const outcome=await processItem(uid,item);await enqueueEvent({userId:uid,type:"engineering.handoff_progress",title:"Georgie advanced background engineering work",body:`${item.objective}: ${outcome?.summary||outcome?.status||"updated"}`,priority:item.priority>=95?"high":"normal",dedupeKey:`handoff:${item.id}:${outcome?.status}`,data:{handoffId:item.id,status:outcome?.status,source:item.source}});return{status:"processed",handoffId:item.id,outcome};}
    catch(error){const failed=await failHandoff(uid,item.id,error);return{status:failed?.status||"failed",handoffId:item.id,error:error instanceof Error?error.message:String(error)};}
  }finally{running=false;}
}
export function startEngineeringCoordinator(){if(timer||process.env.NODE_ENV==="test"||process.env.GEORGIE_ENGINEERING_COORDINATOR_ENABLED==="false")return timer;const execute=()=>runEngineeringCoordinatorCycle().catch(error=>console.warn("Engineering coordinator delayed:",error instanceof Error?error.message:error));setTimeout(execute,25_000).unref?.();timer=setInterval(execute,INTERVAL);timer.unref?.();return timer;}
