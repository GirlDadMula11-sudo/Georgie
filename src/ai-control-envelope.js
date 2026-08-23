import crypto from "node:crypto";

const MARKER=/<!--\s*ai-control:v1\s*\n([\s\S]*?)\n-->/g;
const SECRET_KEY=/(password|passwd|secret|token|api[_-]?key|private[_-]?key|cookie|authorization|credential|invite[_-]?code)/i;
const TOOL=/^[a-z0-9_.-]{3,160}$/i;
const ID=/^[a-zA-Z0-9_.:-]{6,220}$/;
const bounded=(value,max=4000)=>String(value??"").trim().slice(0,max);
const digest=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function containsSecretShape(value,path=""){
  if(Array.isArray(value))return value.some((item,index)=>containsSecretShape(item,`${path}[${index}]`));
  if(!value||typeof value!=="object")return false;
  return Object.entries(value).some(([key,item])=>SECRET_KEY.test(key)||containsSecretShape(item,path?`${path}.${key}`:key));
}

function cleanObject(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
function cleanList(value,max=40){return Array.isArray(value)?value.map(v=>bounded(v,1000)).filter(Boolean).slice(0,max):[];}

export function normalizeAIControlEnvelope(input={}){
  if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("AI control envelope must be an object");
  if(containsSecretShape(input))throw new Error("AI control envelope contains secret-shaped fields");
  const envelope={
    protocol:"ai-control.v1",
    commandId:bounded(input.commandId,220),
    objectiveId:bounded(input.objectiveId,220),
    parentObjectiveId:bounded(input.parentObjectiveId,220)||null,
    sender:bounded(input.sender||"chatgpt",80),
    recipient:bounded(input.recipient||"georgie",80),
    tool:bounded(input.tool,160),
    args:cleanObject(input.args),
    risk:bounded(input.risk||"read",80),
    requestedAuthority:bounded(input.requestedAuthority||"automatic_safe_work",120),
    approvalRef:bounded(input.approvalRef,220)||null,
    idempotencyKey:bounded(input.idempotencyKey,220),
    mutationScope:bounded(input.mutationScope,300)||null,
    dependsOn:cleanList(input.dependsOn,30),
    acceptanceCriteria:cleanList(input.acceptanceCriteria,40),
    evidenceRefs:cleanList(input.evidenceRefs,100),
    slaClass:bounded(input.slaClass||"P2",20).toUpperCase(),
    replyChannel:bounded(input.replyChannel||"github_issue",80),
    correlationId:bounded(input.correlationId||input.commandId,220),
    verification:cleanObject(input.verification)
  };
  if(!ID.test(envelope.commandId))throw new Error("valid commandId required");
  if(!envelope.objectiveId)throw new Error("objectiveId required");
  if(envelope.sender!=="chatgpt"||envelope.recipient!=="georgie")throw new Error("AI control envelope sender/recipient is not allowed");
  if(!TOOL.test(envelope.tool))throw new Error("valid governed tool name required");
  if(!envelope.idempotencyKey)envelope.idempotencyKey=`ai-control:${envelope.commandId}`;
  if(!["P0","P1","P2","P3"].includes(envelope.slaClass))throw new Error("slaClass must be P0, P1, P2, or P3");
  if(envelope.verification.tool&&!TOOL.test(String(envelope.verification.tool)))throw new Error("verification tool is invalid");
  envelope.integrityHash=digest(envelope);
  return envelope;
}

export function parseAIControlEnvelopes(text=""){
  const out=[];let match;
  MARKER.lastIndex=0;
  while((match=MARKER.exec(String(text||"")))){
    try{out.push({ok:true,envelope:normalizeAIControlEnvelope(JSON.parse(match[1]))});}
    catch(error){out.push({ok:false,error:error instanceof Error?error.message:String(error)});}
  }
  return out;
}

export function serializeAIControlEnvelope(input={}){
  const envelope=normalizeAIControlEnvelope(input);
  const wire={...envelope};delete wire.integrityHash;
  return `<!-- ai-control:v1\n${JSON.stringify(wire)}\n-->`;
}
