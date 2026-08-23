import { executeTool, listToolDefinitions } from "./tools.js";
import { appendEvidence, acquireObjectiveLease, checkpointObjective, getObjective, listObjectives, markRetryableFailure, transitionObjective } from "./objective-control-plane.js";

const USER=()=>process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const WORKER_ID="georgie-specialist-worker";
const INTERVAL_MS=Math.max(5_000,Number(process.env.GEORGIE_SPECIALIST_WORKER_INTERVAL_MS||15_000));
let timer=null,running=false;

function riskMap(){return new Map(listToolDefinitions().map(tool=>[tool.name,tool.risk]));}
function normalizedPlan(objective){
  const plan=Array.isArray(objective?.metadata?.toolPlan)?objective.metadata.toolPlan:[];
  return plan.map(step=>({tool:String(step?.tool||"").trim(),args:step?.args&&typeof step.args==="object"?step.args:{}})).filter(step=>step.tool);
}
function policyForRisk(risk){if(risk==="read")return"read";if(risk==="low_risk_write")return"low_risk_write";return"sensitive_write";}
function retryableResult(result){const text=String(result?.error||result?.blockedBy||"").toLowerCase();return /timeout|temporar|rate limit|429|502|503|504|unavailable|connection|retry/.test(text);}

export async function runSpecialistObjective(userId=USER(),objectiveId){
  const objective=await getObjective(userId,objectiveId);if(!objective)return{status:"missing"};
  if(objective.state!=="queued")return{status:"not_runnable",state:objective.state};
  const lease=await acquireObjectiveLease(userId,objectiveId,WORKER_ID,{leaseMs:120_000});if(!lease)return{status:"leased_elsewhere"};
  await transitionObjective(userId,objectiveId,"running",{reason:"specialist worker claimed canonical execution objective"});
  const plan=normalizedPlan(await getObjective(userId,objectiveId));
  if(!plan.length){await checkpointObjective(userId,objectiveId,lease.token,{stage:"planning",status:"blocked",reason:"No bounded tool plan is attached to the canonical objective."});await transitionObjective(userId,objectiveId,"blocked",{reason:"No bounded tool plan attached"});return{status:"blocked",reason:"missing_tool_plan"};}
  const risks=riskMap(),results=[];
  for(let index=0;index<plan.length;index+=1){
    const step=plan[index],risk=risks.get(step.tool);
    await checkpointObjective(userId,objectiveId,lease.token,{stage:"before_tool",index,tool:step.tool,risk:risk||"unknown"});
    if(!risk){await transitionObjective(userId,objectiveId,"blocked",{reason:`Unknown governed tool ${step.tool}`});return{status:"blocked",tool:step.tool,reason:"unknown_tool"};}
    if(["sensitive_write","external_side_effect"].includes(risk)){
      await transitionObjective(userId,objectiveId,"human_approval_required",{reason:`${step.tool} requires explicit governed approval`});
      return{status:"approval_needed",tool:step.tool,risk};
    }
    const execution=await executeTool({name:step.tool,args:step.args,userId,policy:policyForRisk(risk)});
    results.push({step,index,execution});
    await checkpointObjective(userId,objectiveId,lease.token,{stage:"after_tool",index,tool:step.tool,ok:execution?.ok!==false});
    await appendEvidence(userId,objectiveId,{kind:"tool_execution",summary:`${step.tool} ${execution?.ok===false?"failed":"completed"}`,verified:execution?.ok===true,details:{index,tool:step.tool,result:execution?.result??null,error:execution?.error??null}},{verifier:WORKER_ID});
    if(execution?.ok===false){if(retryableResult(execution)){const failed=await markRetryableFailure(userId,objectiveId,new Error(execution.error||`${step.tool} failed`));return{status:failed.state,tool:step.tool,error:execution.error};}await transitionObjective(userId,objectiveId,"blocked",{reason:execution.error||`${step.tool} failed`});return{status:"blocked",tool:step.tool,error:execution.error};}
  }
  await transitionObjective(userId,objectiveId,"verifying",{reason:"bounded tool plan executed; verifying evidence"});
  const evidence=results.filter(item=>item.execution?.ok===true).length;
  if(evidence!==plan.length){await transitionObjective(userId,objectiveId,"blocked",{reason:"Not every planned step produced successful evidence"});return{status:"blocked",reason:"incomplete_evidence"};}
  await appendEvidence(userId,objectiveId,{kind:"specialist_completion",summary:`All ${plan.length} bounded specialist steps completed with execution evidence.`,verified:true,details:{stepCount:plan.length}},{verifier:WORKER_ID});
  await transitionObjective(userId,objectiveId,"complete",{reason:"all bounded specialist steps verified"});
  return{status:"complete",stepCount:plan.length,results};
}

export async function runSpecialistWorkerCycle(userId=USER()){
  if(running)return{status:"already_running"};running=true;try{const queued=await listObjectives(userId,{states:["queued"],limit:25});const candidate=queued.find(item=>Array.isArray(item?.metadata?.toolPlan)&&item.metadata.toolPlan.length);if(!candidate)return{status:"idle"};return runSpecialistObjective(userId,candidate.objectiveId);}finally{running=false;}
}

export function startSpecialistExecutionWorker({userId=USER(),intervalMs=INTERVAL_MS}={}){if(timer||process.env.NODE_ENV==="test"||process.env.GEORGIE_SPECIALIST_WORKER_ENABLED==="false")return timer;const run=()=>runSpecialistWorkerCycle(userId).catch(error=>console.warn("Specialist execution worker delayed:",error?.message||error));setTimeout(run,5_000).unref?.();timer=setInterval(run,Math.max(5_000,Number(intervalMs)||INTERVAL_MS));timer.unref?.();return timer;}

export function specialistExecutionContract(){return{version:"georgie.specialist-execution.v1",canonicalObjectiveLease:true,boundedToolPlanRequired:true,checkpointBeforeAndAfterEveryTool:true,evidencePerStep:true,approvalBoundaryPreserved:true,retryableFailuresRecoverable:true,completionRequiresVerifiedEvidence:true};}
