import { executeTool, listToolDefinitions } from "./tools.js";
import { verifyImmutableExecutionPlan } from "./immutable-execution-plan.js";
import { appendEvidence, acquireObjectiveLease, checkpointObjective, getObjective, listObjectives, markRetryableFailure, transitionObjective } from "./objective-control-plane.js";

const USER=()=>process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const WORKER_ID="georgie-specialist-worker";
const INTERVAL_MS=Math.max(5_000,Number(process.env.GEORGIE_SPECIALIST_WORKER_INTERVAL_MS||15_000));
let timer=null,running=false;

function riskMap(){return new Map(listToolDefinitions().map(tool=>[tool.name,tool.risk]));}
function frozenPackage(objective){return objective?.metadata?.executionPackage&&typeof objective.metadata.executionPackage==="object"?structuredClone(objective.metadata.executionPackage):null;}
function policyForRisk(risk){if(risk==="read")return"read";if(risk==="low_risk_write")return"low_risk_write";return"sensitive_write";}
function retryableResult(result){const text=String(result?.error||result?.blockedBy||"").toLowerCase();return /timeout|temporar|rate limit|429|502|503|504|unavailable|connection|retry/.test(text);}

export async function runSpecialistObjective(userId=USER(),objectiveId){
  const initial=await getObjective(userId,objectiveId);if(!initial)return{status:"missing"};
  if(initial.state!=="queued")return{status:"not_runnable",state:initial.state};
  const lease=await acquireObjectiveLease(userId,objectiveId,WORKER_ID,{leaseMs:120_000});if(!lease)return{status:"leased_elsewhere"};
  await transitionObjective(userId,objectiveId,"running",{reason:"specialist worker claimed canonical execution objective"});
  const objective=await getObjective(userId,objectiveId),executionPackage=frozenPackage(objective),expectedHash=String(objective?.metadata?.executionPlanHash||"");
  if(!executionPackage||!expectedHash||objective?.metadata?.executionPlanFrozen!==true){await checkpointObjective(userId,objectiveId,lease.token,{stage:"planning",status:"blocked",reason:"No frozen immutable execution package is attached."});await transitionObjective(userId,objectiveId,"blocked",{reason:"No immutable execution package attached"});return{status:"blocked",reason:"missing_immutable_plan"};}
  const integrity=verifyImmutableExecutionPlan(executionPackage,expectedHash);
  if(!integrity.ok){await checkpointObjective(userId,objectiveId,lease.token,{stage:"plan_integrity",status:"blocked",expectedHash:integrity.expectedHash,actualHash:integrity.actualHash});await appendEvidence(userId,objectiveId,{kind:"plan_integrity_failure",summary:"Stored execution package hash did not match the immutable plan hash.",verified:true,details:integrity},{verifier:WORKER_ID});await transitionObjective(userId,objectiveId,"blocked",{reason:"Immutable execution plan integrity check failed"});return{status:"blocked",reason:"plan_hash_mismatch",integrity};}
  const plan=Array.isArray(executionPackage.steps)?executionPackage.steps:[];
  if(!plan.length){await checkpointObjective(userId,objectiveId,lease.token,{stage:"planning",status:"blocked",reason:"Frozen package contains no executable steps."});await transitionObjective(userId,objectiveId,"blocked",{reason:"Immutable execution package has no steps"});return{status:"blocked",reason:"empty_immutable_plan"};}
  await checkpointObjective(userId,objectiveId,lease.token,{stage:"plan_verified",planHash:expectedHash,stepCount:plan.length,specialistId:executionPackage.specialistId||null});
  const risks=riskMap(),results=[];
  for(let index=0;index<plan.length;index+=1){
    const step=plan[index],tool=String(step?.tool||"").trim(),registeredRisk=risks.get(tool);
    await checkpointObjective(userId,objectiveId,lease.token,{stage:"before_tool",index,tool,risk:registeredRisk||"unknown",planHash:expectedHash});
    if(!registeredRisk||registeredRisk!==step.risk){await transitionObjective(userId,objectiveId,"blocked",{reason:`Governed tool risk contract changed for ${tool}`});return{status:"blocked",tool,reason:"tool_contract_drift"};}
    if(step.requiresApproval===true||["sensitive_write","external_side_effect"].includes(registeredRisk)){
      await transitionObjective(userId,objectiveId,"human_approval_required",{reason:`${tool} requires explicit governed approval under immutable plan ${expectedHash}`});
      return{status:"approval_needed",tool,risk:registeredRisk,planHash:expectedHash};
    }
    const execution=await executeTool({name:tool,args:structuredClone(step.args||{}),userId,policy:policyForRisk(registeredRisk)});
    results.push({step:{index,tool,risk:registeredRisk},execution});
    await checkpointObjective(userId,objectiveId,lease.token,{stage:"after_tool",index,tool,ok:execution?.ok!==false,planHash:expectedHash});
    await appendEvidence(userId,objectiveId,{kind:"tool_execution",summary:`${tool} ${execution?.ok===false?"failed":"completed"} under immutable plan ${expectedHash}`,verified:execution?.ok===true,hash:expectedHash,details:{index,tool,risk:registeredRisk,result:execution?.result??null,error:execution?.error??null}},{verifier:WORKER_ID});
    if(execution?.ok===false){if(retryableResult(execution)){const failed=await markRetryableFailure(userId,objectiveId,new Error(execution.error||`${tool} failed`));return{status:failed.state,tool,error:execution.error,planHash:expectedHash};}await transitionObjective(userId,objectiveId,"blocked",{reason:execution.error||`${tool} failed`});return{status:"blocked",tool,error:execution.error,planHash:expectedHash};}
  }
  await transitionObjective(userId,objectiveId,"verifying",{reason:`immutable plan ${expectedHash} executed; verifying evidence`});
  if(results.filter(item=>item.execution?.ok===true).length!==plan.length){await transitionObjective(userId,objectiveId,"blocked",{reason:"Not every immutable plan step produced successful evidence"});return{status:"blocked",reason:"incomplete_evidence",planHash:expectedHash};}
  await appendEvidence(userId,objectiveId,{kind:"specialist_completion",summary:`All ${plan.length} immutable specialist steps completed with execution evidence.`,verified:true,hash:expectedHash,details:{stepCount:plan.length,planHash:expectedHash}},{verifier:WORKER_ID});
  await transitionObjective(userId,objectiveId,"complete",{reason:`all steps verified against immutable plan ${expectedHash}`});
  return{status:"complete",stepCount:plan.length,planHash:expectedHash,results};
}

export async function runSpecialistWorkerCycle(userId=USER()){
  if(running)return{status:"already_running"};running=true;try{const queued=await listObjectives(userId,{states:["queued"],limit:25});const candidate=queued.find(item=>item?.metadata?.executionPlanFrozen===true&&item?.metadata?.executionPlanHash&&Array.isArray(item?.metadata?.executionPackage?.steps)&&item.metadata.executionPackage.steps.length);if(!candidate)return{status:"idle"};return runSpecialistObjective(userId,candidate.objectiveId);}finally{running=false;}
}

export function startSpecialistExecutionWorker({userId=USER(),intervalMs=INTERVAL_MS}={}){if(timer||process.env.NODE_ENV==="test"||process.env.GEORGIE_SPECIALIST_WORKER_ENABLED==="false")return timer;const run=()=>runSpecialistWorkerCycle(userId).catch(error=>console.warn("Specialist execution worker delayed:",error?.message||error));setTimeout(run,5_000).unref?.();timer=setInterval(run,Math.max(5_000,Number(intervalMs)||INTERVAL_MS));timer.unref?.();return timer;}

export function specialistExecutionContract(){return{version:"georgie.specialist-execution.v2-immutable-plan",canonicalObjectiveLease:true,immutablePlanHashRequired:true,hashReverifiedBeforeExecution:true,noMidFlightReplan:true,checkpointBeforeAndAfterEveryTool:true,evidencePerStep:true,toolRiskDriftFailsClosed:true,approvalBoundaryPreserved:true,retryableFailuresRecoverable:true,completionRequiresVerifiedEvidence:true};}
