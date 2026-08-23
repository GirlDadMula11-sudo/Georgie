import crypto from "node:crypto";
import { prepareObjectiveControlContext, issueCommand, createHandoff, registerParticipant } from "./coordination-control-plane.js";
import { selectSpecialist, listSpecialists } from "./specialist-registry.js";

const digest=value=>crypto.createHash("sha256").update(String(value||"")).digest("hex");

export async function routeIncomingCommand(userId="primary",input={}){
  const objective=await prepareObjectiveControlContext(userId,input);
  if(!input?.requiresTools)return{objective,command:null,handoff:null,specialist:null};
  const selection=selectSpecialist(input);
  const specialist=selection.specialist;
  await registerParticipant(userId,{id:specialist.id,role:specialist.role,authority:"bounded_specialist_worker",capabilities:specialist.capabilities,callbackMode:"durable_pull",endpointBound:true});
  const idempotencyKey=`incoming:${objective.objectiveId}:${digest(`${input.text}|${specialist.id}`).slice(0,24)}`;
  const issued=await issueCommand(userId,{objectiveId:objective.objectiveId,issuer:"georgie",assignee:specialist.id,action:"execute_bounded_objective",scope:{domain:input.domain,kind:input.kind,exclusiveResource:`objective:${objective.objectiveId}`},arguments:{instruction:input.text,specialistRole:specialist.role},acceptanceCriteria:["Publish evidence for consequential claims","Return an explicit terminal status","Do not expand scope without a new governed plan"],idempotencyKey});
  const handoff=await createHandoff(userId,{objectiveId:objective.objectiveId,from:"georgie",to:specialist.id,summary:input.text,commandIds:issued?.command?.id?[issued.command.id]:[],requestedCapabilities:selection.requiredCapabilities,idempotencyKey:`handoff:${idempotencyKey}`});
  return{objective,command:issued,handoff,specialist:{...specialist,requiredCapabilities:selection.requiredCapabilities,selectionReason:selection.reason}};
}

export function specialistRegistryContract(){return{version:"georgie.specialist-registry.v1",workers:listSpecialists().map(({id,role,capabilities})=>({id,role,capabilities})),incomingCommandsBecomeDurableObjectives:true,typedCommandEnvelope:true,durableHandoff:true};}
