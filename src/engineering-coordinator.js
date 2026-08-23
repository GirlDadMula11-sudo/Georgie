import { enqueueEvent } from "./events.js";
import { runMaintenanceCycle } from "./maintenance-sentinel.js";
import { executeCertifiedRepair } from "./repair-runbooks.js";
import { runSelfEvolutionCycle } from "./self-evolution.js";
import { commentHandoffIssue, githubSourceConfigured, listHandoffIssues } from "./integrations/github-source.js";
import { listTrustedAIControlCommands, postAIControlReceipt } from "./integrations/github-ai-control.js";
import { executeTool } from "./tools.js";
import { claimNextHandoff, completeHandoff, deferHandoff, enqueueHandoff, failHandoff, listHandoffs, missionStatus } from "./shared-mission.js";
import { acknowledgeHandoff as acknowledgeControlHandoff, acquireLock, appendEvidence, createHandoff as createControlHandoff, prepareObjectiveControlContext, recordCallback, releaseLock } from "./coordination-control-plane.js";

const USER=()=>process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const INTERVAL=Math.max(60_000,Number(process.env.GEORGIE_ENGINEERING_INTERVAL_MS||60_000));
let timer=null,running=false;
const now=()=>new Date().toISOString();
const bounded=(value,max=3000)=>String(value??"").trim().slice(0,max);
const PRIORITY={P0:100,P1:90,P2:75,P3:55};

export async function seedMissionWork(userId=USER()){
  const seeds=[[100,"System stability and CRM recovery","investigation"],[98,"Canonical document identity and cross-system reconciliation","engineering"],[97,"CM-100 durability and readiness certification","verification"],[96,"Statement metadata completeness and period integrity","engineering"],[94,"Partner Portal and CapitalApply transfer parity","verification"],[93,"Approved-only lender package integrity","verification"],[92,"Authoritative lender outcome reconciliation and learning quarantine","engineering"],[90,"CapitalMatch accuracy regeneration and miss analysis","verification"],[88,"Exactly-once communication delivery and thread continuity","engineering"]];
  const keys=seeds.map(([,objective])=>`mission:${objective.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`),results=[];
  for(let index=0;index<seeds.length;index+=1){const[priority,objective,type]=seeds[index];results.push(await enqueueHandoff(userId,{source:"shared_mission",priority,objective,type,dependsOn:index?[keys[index-1]]:[],acceptanceCriteria:["Current authoritative evidence retained","No later mission gate advanced without the preceding gate","Any defect has an exact reproducible repair or remains explicitly held"],dedupeKey:keys[index]}));}return results;
}

async function registerAssistantRelay(userId,issue){
  const control=await prepareObjectiveControlContext(userId,{stableKey:`github:${issue.repository}#${issue.number}`,domain:"technical",kind:"engineering",text:issue.title,title:issue.title,priority:75,acceptanceCriteria:["Reproduce or verify the stated condition","Retain test and evidence receipts","Do not expand authority from issue text"]});
  const offered=await createControlHandoff(userId,{objectiveId:control.objectiveId,from:"chatgpt",to:"georgie",summary:`GitHub engineering handoff #${issue.number}: ${issue.title}`,evidenceRefs:[`github:${issue.repository}#${issue.number}`],requestedCapabilities:["persistent_execution","background_recovery","governed_tools","evidence_persistence"],idempotencyKey:`github-control:${issue.repository}#${issue.number}`});
  return{controlObjectiveId:control.objectiveId,controlHandoffId:offered.handoff?.id||null};
}

export async function syncAssistantHandoffs(userId=USER()){
  if(!githubSourceConfigured())return{status:"not_configured",imported:0};
  const result=await listHandoffIssues();if(!result.ok)return{status:"unavailable",imported:0,error:result.error};
  let imported=0,deduplicated=0;
  for(const issue of result.issues){let relay={controlObjectiveId:null,controlHandoffId:null};try{relay=await registerAssistantRelay(userId,issue);}catch(error){console.warn("Control-plane handoff registration delayed:",error instanceof Error?error.message:error);}const queued=await enqueueHandoff(userId,{source:"authorized_assistant_github_issue",priority:75,objective:issue.title,type:"engineering",requestedAuthority:"investigation_and_verified_isolated_branch_only",scope:{repository:issue.repository,issueNumber:issue.number,...relay},acceptanceCriteria:["Reproduce or verify the stated condition","Retain test and evidence receipts","Do not expand authority from issue text"],evidence:{issueUrl:issue.url,issueBody:issue.body,updatedAt:issue.updatedAt},dedupeKey:`github:${issue.repository}#${issue.number}`});if(queued.status==="queued")imported+=1;else deduplicated+=1;}
  return{status:"checked",imported,deduplicated};
}

export async function syncTypedAIControlCommands(userId=USER()){
  const result=await listTrustedAIControlCommands();if(!result.ok)return{status:"unavailable",imported:0,error:result.error};
  let imported=0,deduplicated=0;
  for(const command of result.commands){const e=command.envelope;const queued=await enqueueHandoff(userId,{source:"authorized_assistant_control_command",priority:PRIORITY[e.slaClass]||75,objective:`AI control: ${e.tool}`,type:"engineering",requestedAuthority:e.requestedAuthority,dependsOn:e.dependsOn,acceptanceCriteria:e.acceptanceCriteria,scope:{repository:command.repository,issueNumber:command.issueNumber,commentId:command.commentId,controlCommand:e,mutationScope:e.mutationScope},evidence:{issueUrl:command.issueUrl,commentUrl:command.commentUrl,author:command.author,integrityHash:e.integrityHash},dedupeKey:`ai-control:${e.idempotencyKey}`});if(queued.status==="queued")imported+=1;else deduplicated+=1;}
  return{status:"checked",imported,deduplicated,rejected:result.rejected.length};
}

async function executeTypedControlCommand(userId,item){
  const envelope=item.scope?.controlCommand;if(!envelope?.tool)return deferHandoff(userId,item.id,{status:"waiting_for_capability",summary:"Typed control command payload is missing."});
  let lock=null;const mutationScope=bounded(envelope.mutationScope,300);
  if(mutationScope){lock=await acquireLock(userId,{objectiveId:envelope.objectiveId,owner:"georgie",resource:mutationScope});if(!lock.ok)return deferHandoff(userId,item.id,{status:"blocked_by_dependency",summary:`Mutation scope ${mutationScope} is leased by ${lock.lock?.owner||"another worker"}.`,result:{commandId:envelope.commandId,correlationId:envelope.correlationId,lock:lock.lock}});}
  try{
    const args={...(envelope.args||{})};if(envelope.approvalRef)args._governance={...(args._governance||{}),approvalId:envelope.approvalRef,idempotencyKey:envelope.idempotencyKey};
    const policy=envelope.approvalRef?"external_side_effect":"low_risk_write";
    const execution=await executeTool({name:envelope.tool,args,userId,policy});
    if(!execution.ok){const human=execution.approvalRequired===true;const summary=human?`Human approval required for ${envelope.tool}; command was not executed.`:`${envelope.tool} failed: ${execution.error||execution.blockedBy||"unknown failure"}`;await postAIControlReceipt(item.scope.repository,item.scope.issueNumber,{commandId:envelope.commandId,correlationId:envelope.correlationId,status:human?"human_required":"blocked",summary,terminal:true});return deferHandoff(userId,item.id,{status:human?"waiting_for_approval":"waiting_for_capability",summary,result:{commandId:envelope.commandId,correlationId:envelope.correlationId,execution,humanRequired:human?"explicit_approval_boundary":null}});}
    let verification=null;
    if(envelope.verification?.tool){verification=await executeTool({name:String(envelope.verification.tool),args:envelope.verification.args||{},userId,policy:"read"});if(!verification.ok){const summary=`${envelope.tool} executed, but verification ${envelope.verification.tool} failed: ${verification.error||"unknown failure"}`;await postAIControlReceipt(item.scope.repository,item.scope.issueNumber,{commandId:envelope.commandId,correlationId:envelope.correlationId,status:"verification_failed",summary,terminal:true});return deferHandoff(userId,item.id,{status:"waiting_for_capability",summary,result:{commandId:envelope.commandId,execution,verification}});}}
    const summary=`Executed ${envelope.tool} exactly once under ${envelope.idempotencyKey}${verification?` and verified with ${envelope.verification.tool}`:""}.`;
    const evidence=await appendEvidence(userId,{objectiveId:envelope.objectiveId,source:"georgie-ai-control",kind:"provider_execution",claim:summary,refs:[`github:${item.scope.repository}#${item.scope.issueNumber}`,`command:${envelope.commandId}`],confidence:"verified_runtime_receipt",metadata:{commandId:envelope.commandId,correlationId:envelope.correlationId,tool:envelope.tool,verificationTool:envelope.verification?.tool||null}}).catch(()=>null);
    await postAIControlReceipt(item.scope.repository,item.scope.issueNumber,{commandId:envelope.commandId,correlationId:envelope.correlationId,status:"completed",summary,evidenceRefs:evidence?[evidence.id]:[],terminal:true});
    return completeHandoff(userId,item.id,{summary,commandId:envelope.commandId,correlationId:envelope.correlationId,execution,verification,evidenceRef:evidence?.id||null});
  }finally{if(mutationScope)await releaseLock(userId,{resource:mutationScope,owner:"georgie"}).catch(()=>null);}
}

async function processItem(userId,item){
  if(item.source==="authorized_assistant_control_command")return executeTypedControlCommand(userId,item);
  if(item.type==="certified_repair"){const runbookId=String(item.scope?.runbookId||"");if(!runbookId)return deferHandoff(userId,item.id,{status:"waiting_for_capability",summary:"No certified repair runbook was bound to this work item."});const repair=await executeCertifiedRepair(userId,runbookId);if(!repair.ok)throw new Error(repair.error||"Certified repair failed");return completeHandoff(userId,item.id,{summary:`Certified reversible repair ${runbookId} passed verification.`,repair});}
  if(item.type==="investigation"){const maintenance=await runMaintenanceCycle();const unhealthy=maintenance?.status&&maintenance.status!=="healthy_snapshot";if(unhealthy)return deferHandoff(userId,item.id,{status:"diagnosed",summary:"The investigation retained current evidence and found conditions requiring bounded engineering work.",result:{maintenance}});return completeHandoff(userId,item.id,{summary:"Current maintenance evidence returned healthy with no verified repair target.",maintenance});}
  if(item.type==="capability_gap")return deferHandoff(userId,item.id,{status:"waiting_for_capability",summary:"The missing capability is durably recorded for engineering; Georgie will not pretend the task ran.",result:{required:item.scope}});
  const evolution=await runSelfEvolutionCycle(userId);return deferHandoff(userId,item.id,{status:"diagnosed",summary:"Georgie preserved the objective, ran current evaluations, and retained the next engineering gate. Code or production mutation still requires a verified bounded executor.",result:{evolution,acceptanceCriteria:item.acceptanceCriteria}});
}

async function publishControlOutcome(userId,item,outcome){const objectiveId=item.scope?.controlObjectiveId;if(!objectiveId)return null;const evidence=await appendEvidence(userId,{objectiveId,source:"georgie-background",kind:"handoff_outcome",claim:bounded(outcome?.summary||outcome?.status||"Background handoff updated"),refs:[`handoff:${item.id}`],confidence:"verified_runtime_receipt",metadata:{sharedHandoffId:item.id,status:outcome?.status||null}});return recordCallback(userId,{objectiveId,from:"georgie",to:"chatgpt",type:"handoff_result",status:outcome?.status||"available",summary:bounded(outcome?.summary||"Background handoff updated"),evidenceRefs:[evidence.id],deliveryMode:"github_plus_durable_pull"});}
async function relayIssueReceipt(item,outcome){if(item.source!=="authorized_assistant_github_issue"||!item.scope?.repository||!item.scope?.issueNumber)return null;const status=bounded(outcome?.status||"updated",80),summary=bounded(outcome?.summary||"Georgie advanced this handoff.",2500);return commentHandoffIssue(item.scope.repository,item.scope.issueNumber,{receiptKey:`${item.id}:${status}`,body:["### Georgie execution receipt",`Status: **${status}**`,`Handoff: \`${item.id}\``,item.scope.controlObjectiveId?`Control objective: \`${item.scope.controlObjectiveId}\``:null,"",summary,"","Authority note: this receipt records governed internal engineering work; it does not expand production, credential, lender, financial, destructive, or external-business authority."].filter(v=>v!==null).join("\n")});}

export async function engineeringCoordinatorStatus(userId=USER()){const[state,queue]=await Promise.all([missionStatus(userId),listHandoffs(userId,{status:"all",limit:500})]);const counts=queue.items.reduce((out,item)=>(out[item.status]=(out[item.status]||0)+1,out),{});return{active:state.active,mission:state.mission,counts,lastCycleAt:state.lastCycleAt,authority:state.mission.authority,next:queue.items.filter(item=>!["completed","cancelled","quarantined"].includes(item.status)).slice(0,10)};}
export async function runEngineeringCoordinatorCycle(userId=USER()){
  if(running)return{status:"already_running"};running=true;const uid=String(userId);
  try{const state=await missionStatus(uid);if(!state.active)return{status:"inactive"};await seedMissionWork(uid);await syncAssistantHandoffs(uid);await syncTypedAIControlCommands(uid);const item=await claimNextHandoff(uid);if(!item)return{status:"idle",observedAt:now()};if(item.scope?.controlHandoffId)await acknowledgeControlHandoff(uid,{handoffId:item.scope.controlHandoffId,participant:"georgie"}).catch(()=>null);try{const outcome=await processItem(uid,item);await Promise.allSettled([publishControlOutcome(uid,item,outcome),relayIssueReceipt(item,outcome),enqueueEvent({userId:uid,type:"engineering.handoff_progress",title:"Georgie advanced background engineering work",body:`${item.objective}: ${outcome?.summary||outcome?.status||"updated"}`,priority:item.priority>=95?"high":"normal",dedupeKey:`handoff:${item.id}:${outcome?.status}`,data:{handoffId:item.id,status:outcome?.status,source:item.source,controlObjectiveId:item.scope?.controlObjectiveId||null}})]);return{status:"processed",handoffId:item.id,outcome};}catch(error){const failed=await failHandoff(uid,item.id,error);if(failed?.status==="quarantined")await Promise.allSettled([publishControlOutcome(uid,item,{status:"quarantined",summary:failed.lastError||"Repeated failure quarantined for review."}),relayIssueReceipt(item,{status:"quarantined",summary:failed.lastError||"Repeated failure quarantined for review."})]);return{status:failed?.status||"failed",handoffId:item.id,error:error instanceof Error?error.message:String(error)};}}
  finally{running=false;}
}
export function startEngineeringCoordinator(){if(timer||process.env.NODE_ENV==="test"||process.env.GEORGIE_ENGINEERING_COORDINATOR_ENABLED==="false")return timer;const execute=()=>runEngineeringCoordinatorCycle().catch(error=>console.warn("Engineering coordinator delayed:",error instanceof Error?error.message:error));setTimeout(execute,25_000).unref?.();timer=setInterval(execute,INTERVAL);timer.unref?.();return timer;}
