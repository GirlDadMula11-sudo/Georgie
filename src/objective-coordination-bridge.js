import { createObjective, getObjective } from "./objective-control-plane.js";

const clean=value=>String(value||"").trim();

export async function ensureCanonicalExecutionObjective(userId="primary",{coordinationObjectiveId,title,instruction,source="georgie-runtime",metadata={},executionPackage=null,executionPlanHash=null}={}){
  const coordinationId=clean(coordinationObjectiveId);
  if(!coordinationId)throw new Error("coordinationObjectiveId is required");
  const objective=await createObjective({
    userId,
    title:clean(title)||"Georgie governed objective",
    instruction:clean(instruction)||clean(title)||"Continue the governed objective from durable evidence.",
    source,
    idempotencyKey:`coordination:${coordinationId}`,
    metadata:{...metadata,coordinationObjectiveId:coordinationId,canonicalExecution:true,executionPackage:executionPackage||null,executionPlanHash:clean(executionPlanHash)||null,executionPlanFrozen:Boolean(executionPackage&&executionPlanHash)}
  });
  const existingHash=clean(objective?.metadata?.executionPlanHash);
  if(existingHash&&executionPlanHash&&existingHash!==clean(executionPlanHash))throw new Error("Canonical execution objective is already bound to a different immutable plan hash");
  return objective;
}

export async function canonicalExecutionObjectiveStatus(userId="primary",objectiveId){
  const objective=await getObjective(userId,objectiveId);
  return objective?{objectiveId:objective.objectiveId,state:objective.state,attempt:objective.attempt,lease:objective.lease,checkpointCount:objective.checkpoints.length,evidenceReceiptCount:objective.evidenceReceiptIds.length,coordinationObjectiveId:objective.metadata?.coordinationObjectiveId||null,executionPlanHash:objective.metadata?.executionPlanHash||null,executionPlanFrozen:objective.metadata?.executionPlanFrozen===true,stepCount:Array.isArray(objective.metadata?.executionPackage?.steps)?objective.metadata.executionPackage.steps.length:0}:null;
}

export function objectiveCoordinationBridgeContract(){
  return{version:"georgie.objective-coordination-bridge.v1",singleCanonicalExecutionLease:true,coordinationObjectsAreReferences:true,idempotentByCoordinationObjective:true,duplicateExecutionQueuesForbidden:true,immutableExecutionPackageBoundToCanonicalObjective:true};
}
