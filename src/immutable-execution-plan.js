import crypto from "node:crypto";
import { deterministicToolPlan } from "./fast-intents.js";
import { planActions } from "./georgie.js";
import { listToolDefinitions } from "./tools.js";

const clean=value=>String(value??"").trim();
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;if(value&&typeof value==="object"){return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;}return JSON.stringify(value);}
function sha256(value){return crypto.createHash("sha256").update(canonical(value)).digest("hex");}
function riskMap(){return new Map(listToolDefinitions().map(tool=>[tool.name,{risk:tool.risk||"unknown",description:tool.description||""}]));}
function normalizeActions(actions=[]){
  const risks=riskMap();
  return actions.map((action,index)=>{
    const tool=clean(action?.tool||action?.name);if(!tool)throw new Error(`Execution plan step ${index+1} has no tool`);
    const definition=risks.get(tool);if(!definition)throw new Error(`Execution plan references unknown governed tool ${tool}`);
    const args=action?.args&&typeof action.args==="object"&&!Array.isArray(action.args)?structuredClone(action.args):{};
    return {index,tool,args,risk:definition.risk,requiresApproval:["sensitive_write","external_side_effect"].includes(definition.risk)};
  });
}

export async function buildImmutableExecutionPlan(input,{specialist=null,acceptanceCriteria=[]}={}){
  const text=clean(input?.text||input?.instruction||input);if(!text)throw new Error("Execution planning requires an instruction");
  let actions=deterministicToolPlan(text),source="deterministic";
  if(!actions.length){actions=await planActions(text,listToolDefinitions());source="model_router";}
  const steps=normalizeActions(actions);
  if(!steps.length)return {status:"no_plan",source,plan:null,planHash:null};
  const plan={
    protocol:"georgie.execution-plan.v1",
    instruction:text,
    specialistId:clean(specialist?.id)||null,
    specialistRole:clean(specialist?.role)||null,
    steps,
    acceptanceCriteria:(Array.isArray(acceptanceCriteria)?acceptanceCriteria:[]).map(v=>clean(v)).filter(Boolean).slice(0,40),
    verification:{requireEvidencePerStep:true,requireAllStepsSuccessful:true,allowMidFlightReplan:false},
    authority:{approvalRequiredForRisks:["sensitive_write","external_side_effect"],scopeExpansionAllowed:false}
  };
  return {status:"planned",source,plan,planHash:sha256(plan)};
}

export function verifyImmutableExecutionPlan(plan,expectedHash){
  const actualHash=sha256(plan||{});return {ok:Boolean(expectedHash)&&actualHash===expectedHash,expectedHash:expectedHash||null,actualHash};
}

export function immutableExecutionPlanContract(){return{version:"georgie.execution-plan.v1",canonicalJsonHash:"sha256",exactToolsAndArgs:true,riskBound:true,midFlightReplan:false,scopeExpansion:false};}
