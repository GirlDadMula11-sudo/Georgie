import { createObjective, getObjective } from "./objective-control-plane.js";

const clean=value=>String(value||"").trim();

export async function ensureCanonicalExecutionObjective(userId="primary",{coordinationObjectiveId,title,instruction,source="georgie-runtime",metadata={}}={}){
  const coordinationId=clean(coordinationObjectiveId);
  if(!coordinationId)throw new Error("coordinationObjectiveId is required");
  const objective=await createObjective({
    userId,
    title:clean(title)||"Georgie governed objective",
    instruction:clean(instruction)||clean(title)||"Continue the governed objective from durable evidence.",
    source,
    idempotencyKey:`coordination:${coordinationId}`,
    metadata:{...metadata,coordinationObjectiveId:coordinationId,canonicalExecution:true}
  });
  return objective;
}

export async function canonicalExecutionObjectiveStatus(userId="primary",objectiveId){
  const objective=await getObjective(userId,objectiveId);
  return objective?{objectiveId:objective.objectiveId,state:objective.state,attempt:objective.attempt,lease:objective.lease,checkpointCount:objective.checkpoints.length,evidenceReceiptCount:objective.evidenceReceiptIds.length,coordinationObjectiveId:objective.metadata?.coordinationObjectiveId||null}:null;
}

export function objectiveCoordinationBridgeContract(){
  return{version:"georgie.objective-coordination-bridge.v1",singleCanonicalExecutionLease:true,coordinationObjectsAreReferences:true,idempotentByCoordinationObjective:true,duplicateExecutionQueuesForbidden:true};
}
