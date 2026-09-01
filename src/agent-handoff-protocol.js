import crypto from "node:crypto";

const SECRET_KEY=/(password|passwd|secret|token|api[_-]?key|private[_-]?key|cookie|authorization|credential)/i;
const ID=/^[a-zA-Z0-9_.:-]{6,160}$/;
const CAPABILITY=/^[a-z0-9_.-]{3,160}$/i;
const TERMINAL=new Set(["verified","blocked","failed","revoked","expired","budget_exhausted"]);
export const AGENT_HANDOFF_CAPABILITIES=Object.freeze(["sierra.deal.read","sierra.portfolio.read","sierra.health.read","sierra.infrastructure.read","sierra.reconciliation.read","system.health.read","objective.status.read","evidence.read","repository.inspect","tests.run"]);
const CAPABILITY_TOOLS=Object.freeze({
  "sierra.deal.read":["sierra.deal"],
  "sierra.portfolio.read":["sierra.portfolio"],
  "sierra.health.read":["sierra.health"],
  "sierra.infrastructure.read":["sierra.infrastructure"],
  "sierra.reconciliation.read":["sierra.apply_inventory","sierra.reconciliation_invariant"],
  "system.health.read":["system.status"],
  "repository.inspect":["developer.repo_inspect"],
  "tests.run":["developer.run_checks"]
});
const bounded=(value,max=4000)=>String(value??"").trim().slice(0,max);
const digest=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function containsSecretShape(value){
  if(Array.isArray(value))return value.some(containsSecretShape);
  if(!value||typeof value!=="object")return false;
  return Object.entries(value).some(([key,item])=>SECRET_KEY.test(key)||containsSecretShape(item));
}
function list(value,max=40,itemMax=1000){return Array.isArray(value)?[...new Set(value.map(item=>bounded(item,itemMax)).filter(Boolean))].slice(0,max):[];}
function iso(value,fallback){const parsed=Date.parse(value||"");return Number.isFinite(parsed)?new Date(parsed).toISOString():fallback;}
function isSierraWorkflowObjective(value){const text=bounded(value,6000).toLowerCase();return /\b(?:sierra|crm|capital\s*match|capitalmatch)\b/.test(text)&&/\b(?:workflow|reconcil|production health|reliability|pipeline|operating|end[- ]to[- ]end)\b/.test(text);}
function requiredForObjective(objective,requested=[]){const values=[...requested];if(isSierraWorkflowObjective(objective))values.push("sierra.health.read","sierra.infrastructure.read","sierra.reconciliation.read","sierra.portfolio.read");return[...new Set(values)];}

export function normalizeAgentHandoff(input={},at=Date.now()){
  if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Handoff must be an object");
  if(containsSecretShape(input))throw new Error("Handoff contains secret-shaped fields");
  const issuedAt=iso(input.issuedAt,new Date(at).toISOString());
  const expiresAt=iso(input.expiresAt,new Date(at+24*60*60_000).toISOString());
  const envelope={
    protocol:"georgie-handoff.v1",
    objectiveId:bounded(input.objectiveId,160),
    sequenceNumber:Math.trunc(Number(input.sequenceNumber||1)),
    issuer:bounded(input.issuer||"chatgpt",80).toLowerCase(),
    assignee:bounded(input.assignee||"georgie",80).toLowerCase(),
    objective:bounded(input.objective,6000),
    scope:input.scope&&typeof input.scope==="object"&&!Array.isArray(input.scope)?structuredClone(input.scope):{},
    constraints:list(input.constraints,40,1200),
    requiredCapabilities:requiredForObjective(input.objective,list(input.requiredCapabilities,50,160).map(value=>value.toLowerCase())),
    acceptanceCriteria:list(input.acceptanceCriteria,40,1200),
    evidenceRequirements:list(input.evidenceRequirements,40,1200),
    authority:input.authority&&typeof input.authority==="object"&&!Array.isArray(input.authority)?structuredClone(input.authority):{},
    budget:{maxSteps:Math.max(1,Math.min(100,Math.trunc(Number(input.budget?.maxSteps||25)))),maxRuntimeSeconds:Math.max(30,Math.min(86_400,Math.trunc(Number(input.budget?.maxRuntimeSeconds||3600))))},
    issuedAt,expiresAt,
    leaseSeconds:Math.max(30,Math.min(1800,Math.trunc(Number(input.leaseSeconds||300)))),
    replyMode:bounded(input.replyMode||"durable_pull",40)
  };
  if(!ID.test(envelope.objectiveId))throw new Error("Valid objectiveId required");
  if(!Number.isSafeInteger(envelope.sequenceNumber)||envelope.sequenceNumber<1)throw new Error("sequenceNumber must be a positive integer");
  if(envelope.issuer!=="chatgpt"||envelope.assignee!=="georgie")throw new Error("Handoff issuer/assignee is not allowed");
  if(!envelope.objective)throw new Error("Objective required");
  if(envelope.requiredCapabilities.some(value=>!CAPABILITY.test(value)))throw new Error("Invalid required capability");
  const unsupported=envelope.requiredCapabilities.filter(value=>!AGENT_HANDOFF_CAPABILITIES.includes(value));
  if(unsupported.length)throw new Error(`CAPABILITY_MISMATCH: ${unsupported.join(", ")}`);
  if(Date.parse(envelope.expiresAt)<=at)throw new Error("Handoff expired");
  if(Date.parse(envelope.expiresAt)-Date.parse(envelope.issuedAt)>7*24*60*60_000)throw new Error("Handoff lifetime exceeds seven days");
  envelope.idempotencyKey=bounded(input.idempotencyKey,200)||`handoff:${envelope.objectiveId}:v${envelope.sequenceNumber}`;
  envelope.integrityHash=digest(envelope);
  return envelope;
}

export function handoffConnectorInput(input={},at=Date.now()){
  const envelope=normalizeAgentHandoff(input,at);
  const command=isSierraWorkflowObjective(envelope.objective)?`Inspect Sierra's end-to-end workflow health and reconciliation status read-only. Run fresh Sierra health, infrastructure, Apply inventory, reconciliation invariant, and portfolio reads. Change nothing and report missing evidence as a blocker. Original objective: ${envelope.objective}`:envelope.objective;
  return{source:"chatgpt",objectiveId:envelope.objectiveId,idempotencyKey:envelope.idempotencyKey,command,metadata:{agent_handoff:envelope,requiredCapabilities:envelope.requiredCapabilities,sequenceNumber:envelope.sequenceNumber,expiresAt:envelope.expiresAt,budget:envelope.budget}};
}

export function evaluateHandoffEvidence(command={},result={}){
  const handoff=command.metadata?.agent_handoff;
  if(!handoff)return{required:false,satisfied:true,missingCapabilities:[],missingTools:[]};
  const required=requiredForObjective(handoff.objective||command.command,handoff.requiredCapabilities||command.metadata?.requiredCapabilities||[]);
  const actions=Array.isArray(result?.actions)?result.actions:[];
  const successfulTools=new Set(actions.filter(action=>action?.ok===true&&action?.result!==undefined&&action?.result!==null).map(action=>bounded(action.tool,160)));
  const missingCapabilities=[],missingTools=[];
  for(const capability of required){const tools=CAPABILITY_TOOLS[capability]||[],absent=tools.filter(tool=>!successfulTools.has(tool));if(absent.length){missingCapabilities.push(capability);missingTools.push(...absent);}}
  return{required:true,satisfied:missingCapabilities.length===0,requiredCapabilities:required,successfulTools:[...successfulTools],missingCapabilities,missingTools:[...new Set(missingTools)],reason:missingCapabilities.length?`HANDOFF_REQUIRED_EVIDENCE_MISSING: ${missingCapabilities.join(", ")}`:null};
}

export function reconcileHandoffStatus(command={}){
  const raw=bounded(command.status,80).toLowerCase();
  const verified=command.verificationState==="verified"||command.result?.verification?.verified===true||command.receipts?.some(receipt=>receipt?.payload?.readBackVerified===true);
  const state=raw==="cancelled"?"revoked":raw==="completed"?(verified?"verified":"executed_unverified"):raw==="recovering"?"running":raw||"unknown";
  return{objectiveId:command.objectiveId||null,commandId:command.id||command.commandId||null,sequenceNumber:Number(command.metadata?.agent_handoff?.sequenceNumber||command.metadata?.sequenceNumber||1),state,terminal:TERMINAL.has(state),verified:state==="verified",completionClaimAllowed:state==="verified",lease:command.lease||null,evidenceReceipts:Array.isArray(command.receipts)?command.receipts.map(item=>item.receiptId).filter(Boolean):[]};
}
