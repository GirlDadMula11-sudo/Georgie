import crypto from "node:crypto";
import { createApprovalRequest, decideApproval, listApprovals } from "./command-layer.js";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { isExplicitConversationalApproval } from "./approval-language.js";

const NS="approval_continuation";

const clean=value=>String(value||"").trim();
const now=()=>new Date().toISOString();

export function isConversationalApproval(input){return isExplicitConversationalApproval(input);}

export function preflightExecution(execution,availableTools=[]){
  if(!execution||typeof execution!=="object"||!clean(execution.tool))return{ok:false,missingTool:"approval.execution_descriptor",reason:"The approved plan has no exact execution tool and bounded arguments."};
  const verificationNames=Array.isArray(execution.verificationTools)?execution.verificationTools:Array.isArray(execution.verification)?execution.verification.map(item=>item?.tool):[];
  const required=[execution.tool,...verificationNames].map(clean).filter(Boolean);
  const known=new Set(availableTools.map(item=>typeof item==="string"?item:item?.name));
  const missing=required.find(name=>!known.has(name));
  return missing?{ok:false,missingTool:missing,reason:`Required tool ${missing} is not attached to this runtime.`}:{ok:true,requiredTools:required};
}

async function readState(userId){return readCloudState(userId,NS,{version:1,plans:[]});}
async function saveState(userId,state){const saved=await writeCloudState(userId,NS,{...state,version:1,updatedAt:now(),plans:(state.plans||[]).slice(-500)});if(!saved)throw new Error("Durable approval-continuation storage is unavailable");}

export async function prepareApprovalPlan(userId,{sessionId="native",title,summary,steps=[],execution=null,domain="general",risk="high",reversible=false,verificationMethod="",rollbackPlan=""}={}){
  const uid=clean(userId)||"primary",state=await readState(uid),stableKey=crypto.createHash("sha256").update(`${clean(title)}\n${clean(summary)}`).digest("hex").slice(0,24);
  const prior=(state.plans||[]).filter(item=>item.stableKey===stableKey).sort((a,b)=>b.version-a.version)[0];
  const plan={id:crypto.randomUUID(),stableKey,version:Number(prior?.version||0)+1,userId:uid,sessionId:clean(sessionId).slice(0,150),title:clean(title).slice(0,300),summary:clean(summary).slice(0,3000),steps:steps.map(clean).filter(Boolean).slice(0,20),execution:execution&&typeof execution==="object"?execution:null,status:"awaiting_approval",createdAt:now(),updatedAt:now(),approvalId:null,executionResult:null,verification:null,error:null};
  const approval=await createApprovalRequest(uid,{domain,actionType:"execute_versioned_plan",title:`${plan.title} · v${plan.version}`,summary:plan.summary,evidence:{planId:plan.id,planVersion:plan.version,stableKey,steps:plan.steps,execution:plan.execution},risk,reversible,verificationMethod,rollbackPlan});
  plan.approvalId=approval.id;state.plans=[...(state.plans||[]),plan];await saveState(uid,state);return{plan,approval};
}

export async function resolveConversationalApproval(userId,input,{sessionId="native"}={}){
  if(!isConversationalApproval(input))return null;
  const uid=clean(userId)||"primary",pending=await listApprovals(uid,{status:"pending",limit:25});
  const eligible=pending.filter(item=>item.actionType==="execute_versioned_plan"&&item.evidence?.planId);
  if(!eligible.length)return{ok:false,status:"no_eligible_plan",missingTool:null,error:"No pending versioned repair plan is eligible for conversational approval. Ask Georgie to prepare the repair first."};
  const latest=eligible[0],state=await readState(uid),plan=(state.plans||[]).find(item=>item.id===latest.evidence.planId);
  if(!plan)return{ok:false,status:"plan_record_missing",missingTool:"approval.plan_store",error:`Approval ${latest.id} exists, but its durable plan record is missing.`};
  if(plan.sessionId!==clean(sessionId).slice(0,150)&&eligible.length>1)return{ok:false,status:"ambiguous",error:`Approval is ambiguous across ${eligible.length} pending plans. Use an exact approval ID.`};
  const idempotencyKey=`approval:${latest.id}:plan:${plan.id}`;
  plan.dispatch=plan.dispatch||{idempotencyKey,status:"pending_authorization",createdAt:now(),attempts:0,nextAttemptAt:null,receipt:null,lastError:null};plan.updatedAt=now();await saveState(uid,state);
  const approval=await decideApproval(uid,latest.id,{decision:"approved",note:"Explicit conversational approval resolved to the latest eligible versioned plan."});
  plan.status="approved_dispatch_pending";plan.dispatch={...plan.dispatch,status:"pending",authorizedAt:approval.decidedAt||now(),nextAttemptAt:now()};plan.updatedAt=now();await saveState(uid,state);
  return{ok:true,status:"approved_dispatch_pending",plan,approval,execution:plan.execution};
}

export async function listRecoverableApprovalDispatches(userId,{limit=10}={}){
  const uid=clean(userId)||"primary",state=await readState(uid),approved=await listApprovals(uid,{status:"approved",limit:100}),approvedIds=new Set(approved.map(item=>item.id)),current=Date.now();let migrated=false;
  for(const plan of state.plans||[]){if(!plan.execution||!approvedIds.has(plan.approvalId)||plan.dispatch)continue;if(["verified","completed","cancelled","rejected"].includes(plan.status))continue;plan.dispatch={idempotencyKey:`approval:${plan.approvalId}:plan:${plan.id}`,status:"pending",createdAt:now(),authorizedAt:now(),attempts:0,nextAttemptAt:now(),receipt:null,lastError:null,legacyBackfill:true};plan.status="approved_dispatch_pending";plan.updatedAt=now();migrated=true;}
  if(migrated)await saveState(uid,state);
  return(state.plans||[]).filter(plan=>plan.execution&&approvedIds.has(plan.approvalId)&&["pending_authorization","pending","retry_wait","dispatching"].includes(plan.dispatch?.status)&&(!plan.dispatch.nextAttemptAt||new Date(plan.dispatch.nextAttemptAt).getTime()<=current)&&(!plan.dispatch.leaseExpiresAt||new Date(plan.dispatch.leaseExpiresAt).getTime()<=current)).slice(0,Math.max(1,Math.min(Number(limit)||10,50)));
}

export async function approvePlanById(userId,{planId,approvalId,note="Explicit exact-ID plan approval"}={}){
  const uid=clean(userId)||"primary",state=await readState(uid),plan=(state.plans||[]).find(item=>item.id===clean(planId));if(!plan)throw new Error("Exact approval plan was not found");if(plan.approvalId!==clean(approvalId))throw new Error("Approval ID is not bound to the requested plan");
  const pending=await listApprovals(uid,{status:"pending",limit:100}),request=pending.find(item=>item.id===plan.approvalId&&item.evidence?.planId===plan.id);if(!request)throw new Error("Bound approval is not pending or is no longer eligible");
  const idempotencyKey=`approval:${request.id}:plan:${plan.id}`;plan.dispatch=plan.dispatch||{idempotencyKey,status:"pending_authorization",createdAt:now(),attempts:0,nextAttemptAt:null,receipt:null,lastError:null};await saveState(uid,state);
  const approval=await decideApproval(uid,request.id,{decision:"approved",note:clean(note).slice(0,1000)});plan.status="approved_dispatch_pending";plan.dispatch={...plan.dispatch,status:"pending",authorizedAt:approval.decidedAt||now(),nextAttemptAt:now()};plan.updatedAt=now();await saveState(uid,state);return{ok:true,status:"approved_dispatch_pending",plan,approval,execution:plan.execution};
}

export async function recordApprovalDispatch(userId,planId,{status,receipt=null,error=null,retryDelayMs=2000}={}){
  const uid=clean(userId)||"primary",state=await readState(uid),plan=(state.plans||[]).find(item=>item.id===planId);if(!plan)return null;
  const attempts=Number(plan.dispatch?.attempts||0)+(status==="dispatching"?1:0),updated={...(plan.dispatch||{}),status,attempts,lastError:error?clean(error).slice(0,2000):null};
  if(status==="dispatching")updated.leaseExpiresAt=new Date(Date.now()+30_000).toISOString();
  if(status==="accepted"){updated.receipt=receipt;updated.receivedAt=now();updated.leaseExpiresAt=null;updated.nextAttemptAt=null;plan.status="execution_dispatched";}
  if(status==="retry_wait"){updated.leaseExpiresAt=null;updated.nextAttemptAt=new Date(Date.now()+Math.max(500,Number(retryDelayMs)||2000)).toISOString();plan.status="approved_dispatch_retry";}
  plan.dispatch=updated;plan.updatedAt=now();await saveState(uid,state);return plan;
}

export async function transitionApprovalPlan(userId,planId,{status,executionResult=null,verification=null,error=null,missingTool=null}={}){
  const uid=clean(userId)||"primary",state=await readState(uid),plan=(state.plans||[]).find(item=>item.id===planId);if(!plan)return null;
  plan.status=clean(status)||plan.status;plan.executionResult=executionResult;plan.verification=verification;plan.error=error?clean(error).slice(0,2000):null;plan.missingTool=missingTool||null;plan.updatedAt=now();await saveState(uid,state);return plan;
}

export async function listApprovalPlans(userId,{limit=25}={}){const state=await readState(clean(userId)||"primary");return(state.plans||[]).slice(-Math.max(1,Math.min(Number(limit)||25,100))).reverse();}
