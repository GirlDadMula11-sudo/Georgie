import crypto from "node:crypto";
import { prepareObjectiveControlContext, issueCommand, createHandoff, registerParticipant } from "./coordination-control-plane.js";
import { ensureCanonicalExecutionObjective } from "./objective-coordination-bridge.js";
import { buildImmutableExecutionPlan } from "./immutable-execution-plan.js";
import { selectSpecialist, listSpecialists } from "./specialist-registry.js";

const digest=value=>crypto.createHash("sha256").update(String(value||"")).digest("hex");
function authorityAction(input={}){
  const text=String(input.text||"").toLowerCase();
  if(/\bdeploy\b/.test(text)&&/\bproduction\b/.test(text))return"production_deploy";
  if(/\b(delete|drop|destroy|irreversible|wipe)\b/.test(text))return"destructive_or_irreversible_action";
  if(/\b(send|email|message|contact)\b/.test(text)&&/\b(client|partner|lender|merchant|external)\b/.test(text))return"external_business_communication";
  if(/\b(submit|submission)\b/.test(text)&&/\blender\b/.test(text))return"lender_submission";
  if(/\b(schema|migration|database mutation)\b/.test(text))return"database_or_schema_mutation";
  if(/\b(auth|credential|password|token|permission)\b/.test(text)&&/\b(change|rotate|replace|update|modify)\b/.test(text))return"credential_or_auth_change";
  if(/\b(test|verify|certif)\b/.test(text))return"run_tests";
  if(/\b(research|compare)\b/.test(text))return"research";
  if(/\b(inspect|diagnos|audit|review|check|analy[sz]e|trace|investigat)\b/.test(text))return"diagnose";
  return input.consequencePossible?"unclassified_consequential_action":"observe";
}

export async function routeIncomingCommand(userId="primary",input={}){
  const objective=await prepareObjectiveControlContext(userId,input);
  if(!input?.requiresTools){
    const executionObjective=await ensureCanonicalExecutionObjective(userId,{coordinationObjectiveId:objective.objectiveId,title:input.title||input.text,instruction:input.text,metadata:{domain:input.domain,kind:input.kind}});
    return{objective,executionObjective,command:null,handoff:null,specialist:null,executionPlan:null};
  }
  const selection=selectSpecialist(input),specialist=selection.specialist;
  const acceptanceCriteria=["Publish evidence for consequential claims","Return an explicit terminal status","Do not expand scope without a new governed plan"];
  const planned=await buildImmutableExecutionPlan(input,{specialist,acceptanceCriteria});
  if(planned.status!=="planned")throw new Error("No bounded governed tool plan could be produced for this objective");
  const executionObjective=await ensureCanonicalExecutionObjective(userId,{coordinationObjectiveId:objective.objectiveId,title:input.title||input.text,instruction:input.text,metadata:{domain:input.domain,kind:input.kind,plannerSource:planned.source},executionPackage:planned.plan,executionPlanHash:planned.planHash});
  await registerParticipant(userId,{id:specialist.id,role:specialist.role,authority:"bounded_specialist_worker",capabilities:specialist.capabilities,callbackMode:"durable_pull",endpointBound:true});
  const idempotencyKey=`incoming:${objective.objectiveId}:${digest(`${input.text}|${specialist.id}|${planned.planHash}`).slice(0,24)}`;
  const issued=await issueCommand(userId,{objectiveId:objective.objectiveId,issuer:"georgie",assignee:specialist.id,action:authorityAction(input),scope:{domain:input.domain,kind:input.kind,exclusiveResource:`objective:${executionObjective.objectiveId}`,executionObjectiveId:executionObjective.objectiveId,executionPlanHash:planned.planHash},arguments:{instruction:input.text,specialistRole:specialist.role,executionObjectiveId:executionObjective.objectiveId,executionPlanHash:planned.planHash},acceptanceCriteria,idempotencyKey,evidenceRefs:[`plan-sha256:${planned.planHash}`]});
  const handoff=await createHandoff(userId,{objectiveId:objective.objectiveId,from:"georgie",to:specialist.id,summary:input.text,commandIds:issued?.command?.id?[issued.command.id]:[],requestedCapabilities:selection.requiredCapabilities,evidenceRefs:[`execution-objective:${executionObjective.objectiveId}`,`plan-sha256:${planned.planHash}`],idempotencyKey:`handoff:${idempotencyKey}`});
  return{objective,executionObjective,command:issued,handoff,executionPlan:{hash:planned.planHash,source:planned.source,stepCount:planned.plan.steps.length},specialist:{...specialist,requiredCapabilities:selection.requiredCapabilities,selectionReason:selection.reason}};
}

export function specialistRegistryContract(){return{version:"georgie.specialist-registry.v1",workers:listSpecialists().map(({id,role,capabilities})=>({id,role,capabilities})),incomingCommandsBecomeDurableObjectives:true,typedCommandEnvelope:true,durableHandoff:true,singleCanonicalExecutionLease:true,immutablePlanBeforeRouting:true,planHashPropagatedToCommandAndHandoff:true};}
