import crypto from "node:crypto";
import { cloudStateStatus, readCloudState, writeCloudState } from "./cloud-state.js";
import { SHARED_MISSION } from "./shared-mission.js";

const NS="coordination_control_plane_v2";
const USER=()=>process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const DEFAULT_LEASE_MS=Math.max(60_000,Number(process.env.GEORGIE_CONTROL_LEASE_MS||5*60_000));
const MAX_CALLBACK_DELIVERY_ATTEMPTS=Math.max(1,Number(process.env.GEORGIE_CALLBACK_DELIVERY_MAX_ATTEMPTS||8));
const PARTICIPANT_HEARTBEAT_MS=Math.max(30_000,Number(process.env.GEORGIE_CONTROL_PARTICIPANT_HEARTBEAT_MS||60_000));
const localStates=new Map(),mutationChains=new Map();
const now=()=>new Date().toISOString();
const bounded=(value,max=4000)=>String(value??"").trim().slice(0,max);
const clone=value=>structuredClone(value);
const digest=value=>crypto.createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
function serialized(userId,work){const key=String(userId||USER()),prior=mutationChains.get(key)||Promise.resolve();const run=prior.catch(()=>{}).then(work);mutationChains.set(key,run.catch(()=>{}));return run;}
function sameJson(a,b){return JSON.stringify(a)===JSON.stringify(b);}

export const PARTICIPANTS=Object.freeze({
  owner:{id:"jason",role:"owner",authority:"ultimate_user_authority"},
  georgie:{id:"georgie",role:"persistent_operator",authority:"shared_mission_policy"},
  chatgpt:{id:"chatgpt",role:"interactive_engineering_coordinator",authority:"conversation_and_connected_tool_authority"},
  openaiPeer:{id:"openai-peer",role:"api_reasoning_peer",authority:"explicit_server_configuration_only"}
});

export const CONTROL_AUTHORITY=Object.freeze({
  automatic:new Set(SHARED_MISSION.authority.automatic),
  approvalRequired:new Set(SHARED_MISSION.authority.approvalRequired),
  prohibited:new Set(SHARED_MISSION.authority.prohibited)
});

function defaultState(){return{version:2,missionId:SHARED_MISSION.id,participants:{},objectives:[],evidence:[],commands:[],handoffs:[],callbacks:[],locks:[],receipts:[],createdAt:now(),updatedAt:now()};}
async function load(userId=USER()){
  const uid=String(userId||USER());
  const state=cloudStateStatus().enabled?await readCloudState(uid,NS,defaultState()):(localStates.get(uid)||defaultState());
  const normalized={...defaultState(),...state,missionId:SHARED_MISSION.id};
  localStates.set(uid,clone(normalized));return normalized;
}
async function save(userId,state){state.updatedAt=now();localStates.set(String(userId),clone(state));await writeCloudState(String(userId),NS,state);return clone(state);}

export function objectiveIdFor({stableKey="",domain="general",kind="objective",text=""}={}){
  const canonical=`${bounded(stableKey,300)}|${bounded(domain,80).toLowerCase()}|${bounded(kind,80).toLowerCase()}|${bounded(text,6000).toLowerCase().replace(/\s+/g," ")}`;
  return `obj_${digest(canonical).slice(0,24)}`;
}

export function authorityDecision(action=""){
  const name=bounded(action,160);
  if(CONTROL_AUTHORITY.prohibited.has(name))return{decision:"prohibited",action:name,mayExecute:false,approvalRequired:false};
  if(CONTROL_AUTHORITY.approvalRequired.has(name))return{decision:"approval_required",action:name,mayExecute:false,approvalRequired:true};
  if(CONTROL_AUTHORITY.automatic.has(name))return{decision:"automatic",action:name,mayExecute:true,approvalRequired:false};
  return{decision:"unclassified_requires_review",action:name,mayExecute:false,approvalRequired:true};
}

export function registerParticipant(userId=USER(),input={}){return serialized(userId,async()=>{
  const state=await load(userId),id=bounded(input.id,100);if(!id)throw new Error("participant id required");
  const existing=state.participants[id]||{};
  const capabilities=Array.isArray(input.capabilities)?[...new Set(input.capabilities.map(v=>bounded(v,160)).filter(Boolean))].slice(0,200):existing.capabilities||[];
  const proposed={id,role:bounded(input.role||existing.role,120),authority:bounded(input.authority||existing.authority,160),capabilities,callbackMode:bounded(input.callbackMode||existing.callbackMode||"pull",80),endpointBound:Boolean(input.endpointBound)};
  const existingStable={id:existing.id,role:existing.role,authority:existing.authority,capabilities:existing.capabilities||[],callbackMode:existing.callbackMode,endpointBound:Boolean(existing.endpointBound)};
  const unchanged=sameJson(existingStable,proposed),lastSeen=Date.parse(existing.lastSeenAt||0);
  if(unchanged&&Number.isFinite(lastSeen)&&Date.now()-lastSeen<PARTICIPANT_HEARTBEAT_MS)return clone(existing);
  const stamp=now();state.participants[id]={...existing,...proposed,lastSeenAt:stamp,updatedAt:stamp};
  await save(userId,state);return clone(state.participants[id]);
});}

export async function negotiateAssignee(userId=USER(),{requiredCapabilities=[],preferred=[]}={}){
  const state=await load(userId),required=[...new Set(requiredCapabilities.map(v=>bounded(v,160)).filter(Boolean))],preference=new Map(preferred.map((id,index)=>[String(id),index]));
  const candidates=Object.values(state.participants).filter(participant=>required.every(capability=>(participant.capabilities||[]).includes(capability))).sort((a,b)=>(preference.get(a.id)??999)-(preference.get(b.id)??999)||String(b.lastSeenAt||"").localeCompare(String(a.lastSeenAt||"")));
  return candidates.length?{status:"assigned",participant:clone(candidates[0]),requiredCapabilities:required}:{status:"capability_gap",participant:null,requiredCapabilities:required};
}

export function ensureObjective(userId=USER(),input={}){return serialized(userId,async()=>{
  const state=await load(userId),id=bounded(input.id,80)||objectiveIdFor(input);
  let objective=state.objectives.find(row=>row.id===id),created=false;
  if(!objective){objective={id,missionId:SHARED_MISSION.id,createdAt:now(),status:"active",version:1};state.objectives.push(objective);created=true;}
  const proposed={stableKey:bounded(input.stableKey||objective.stableKey,300)||null,title:bounded(input.title||input.text||objective.title,500),text:bounded(input.text||objective.text,6000),domain:bounded(input.domain||objective.domain||"general",80),kind:bounded(input.kind||objective.kind||"objective",80),priority:Math.max(1,Math.min(100,Number(input.priority??objective.priority??50))),status:["active","waiting","blocked","verified","cancelled"].includes(input.status)?input.status:objective.status||"active",acceptanceCriteria:Array.isArray(input.acceptanceCriteria)?input.acceptanceCriteria.map(v=>bounded(v,1200)).filter(Boolean).slice(0,40):objective.acceptanceCriteria||[]};
  const current={stableKey:objective.stableKey??null,title:objective.title||"",text:objective.text||"",domain:objective.domain||"general",kind:objective.kind||"objective",priority:Number(objective.priority??50),status:objective.status||"active",acceptanceCriteria:objective.acceptanceCriteria||[]};
  if(!created&&sameJson(current,proposed))return clone(objective);
  if(!created)objective.version=Number(objective.version||1)+1;
  Object.assign(objective,proposed,{updatedAt:now()});
  state.objectives=state.objectives.slice(-2500);await save(userId,state);return clone(objective);
});}

export function appendEvidence(userId=USER(),input={}){return serialized(userId,async()=>{
  const state=await load(userId),objectiveId=bounded(input.objectiveId,80);if(!objectiveId)throw new Error("objectiveId required");
  const payload={objectiveId,source:bounded(input.source||"unknown",200),kind:bounded(input.kind||"observation",80),claim:bounded(input.claim,5000),refs:Array.isArray(input.refs)?input.refs.map(v=>bounded(v,500)).filter(Boolean).slice(0,50):[],observedAt:input.observedAt||now(),confidence:bounded(input.confidence||"observed",80),metadata:input.metadata&&typeof input.metadata==="object"?input.metadata:{}};
  const evidence={id:`ev_${digest(payload).slice(0,24)}`,...payload,recordedAt:now(),immutableHash:digest(payload)};
  if(state.evidence.some(row=>row.id===evidence.id))return clone(state.evidence.find(row=>row.id===evidence.id));
  state.evidence.push(evidence);state.evidence=state.evidence.slice(-10000);await save(userId,state);return clone(evidence);
});}

function activeLock(state,resource){const at=Date.now();return state.locks.find(lock=>lock.resource===resource&&Date.parse(lock.expiresAt||0)>at)||null;}
export function acquireLock(userId=USER(),{objectiveId,owner,resource,ttlMs=DEFAULT_LEASE_MS}={}){return serialized(userId,async()=>{
  const state=await load(userId),r=bounded(resource,300),o=bounded(owner,100);if(!r||!o)throw new Error("resource and owner required");
  state.locks=state.locks.filter(lock=>Date.parse(lock.expiresAt||0)>Date.now());
  const current=activeLock(state,r);if(current&&current.owner!==o)return{ok:false,status:"conflict",lock:clone(current)};
  const lock=current||{id:crypto.randomUUID(),resource:r,createdAt:now()};
  Object.assign(lock,{objectiveId:bounded(objectiveId,80)||null,owner:o,expiresAt:new Date(Date.now()+Math.max(30_000,Number(ttlMs)||DEFAULT_LEASE_MS)).toISOString(),updatedAt:now()});
  if(!current)state.locks.push(lock);await save(userId,state);return{ok:true,status:current?"renewed":"acquired",lock:clone(lock)};
});}
export function releaseLock(userId=USER(),{resource,owner}={}){return serialized(userId,async()=>{
  const state=await load(userId),r=bounded(resource,300),o=bounded(owner,100),before=state.locks.length;
  state.locks=state.locks.filter(lock=>!(lock.resource===r&&(!o||lock.owner===o)));if(before===state.locks.length)return{released:0};await save(userId,state);return{released:before-state.locks.length};
});}

export function commandEnvelope(input={}){
  const body={objectiveId:bounded(input.objectiveId,80),issuer:bounded(input.issuer,100),assignee:bounded(input.assignee,100),action:bounded(input.action,160),scope:input.scope&&typeof input.scope==="object"?input.scope:{},arguments:input.arguments&&typeof input.arguments==="object"?input.arguments:{},acceptanceCriteria:Array.isArray(input.acceptanceCriteria)?input.acceptanceCriteria.map(v=>bounded(v,1000)).filter(Boolean).slice(0,40):[],evidenceRefs:Array.isArray(input.evidenceRefs)?input.evidenceRefs.map(v=>bounded(v,300)).filter(Boolean).slice(0,100):[],idempotencyKey:bounded(input.idempotencyKey,220),createdAt:input.createdAt||now()};
  if(!body.objectiveId||!body.issuer||!body.assignee||!body.action)throw new Error("objectiveId, issuer, assignee, and action are required");
  const authority=authorityDecision(body.action);return{id:crypto.randomUUID(),protocol:"georgie-control.v2",...body,authority,integrityHash:digest(body),status:"issued"};
}

export function issueCommand(userId=USER(),input={}){return serialized(userId,async()=>{
  const state=await load(userId),envelope=commandEnvelope(input);
  if(envelope.idempotencyKey){const prior=state.commands.find(row=>row.idempotencyKey===envelope.idempotencyKey);if(prior)return{status:"deduplicated",command:clone(prior)};}
  const exclusiveResource=bounded(envelope.scope?.exclusiveResource,300);
  if(exclusiveResource){const current=activeLock(state,exclusiveResource);if(current&&current.owner!==envelope.assignee)return{status:"conflict",command:clone(envelope),lock:clone(current)};}
  if(envelope.authority.decision==="prohibited")envelope.status="rejected";else if(envelope.authority.approvalRequired)envelope.status="approval_needed";else envelope.status="queued";
  state.commands.push(envelope);state.commands=state.commands.slice(-5000);state.receipts.push({id:crypto.randomUUID(),type:"command_issued",commandId:envelope.id,status:envelope.status,at:now()});state.receipts=state.receipts.slice(-10000);await save(userId,state);return{status:envelope.status,command:clone(envelope)};
});}

export function createHandoff(userId=USER(),input={}){return serialized(userId,async()=>{
  const state=await load(userId),objectiveId=bounded(input.objectiveId,80),from=bounded(input.from,100),to=bounded(input.to,100);if(!objectiveId||!from||!to)throw new Error("objectiveId, from, and to are required");
  const key=bounded(input.idempotencyKey,220)||digest({objectiveId,from,to,summary:input.summary||""}).slice(0,32);
  const prior=state.handoffs.find(row=>row.idempotencyKey===key&&!["completed","cancelled"].includes(row.status));if(prior)return{status:"deduplicated",handoff:clone(prior)};
  const handoff={id:crypto.randomUUID(),objectiveId,from,to,idempotencyKey:key,summary:bounded(input.summary,5000),commandIds:Array.isArray(input.commandIds)?input.commandIds.map(v=>bounded(v,100)).filter(Boolean).slice(0,100):[],evidenceRefs:Array.isArray(input.evidenceRefs)?input.evidenceRefs.map(v=>bounded(v,300)).filter(Boolean).slice(0,200):[],requestedCapabilities:Array.isArray(input.requestedCapabilities)?input.requestedCapabilities.map(v=>bounded(v,160)).filter(Boolean).slice(0,100):[],status:"offered",createdAt:now(),updatedAt:now(),acknowledgedAt:null,completedAt:null};
  state.handoffs.push(handoff);state.handoffs=state.handoffs.slice(-5000);await save(userId,state);return{status:"offered",handoff:clone(handoff)};
});}
export function acknowledgeHandoff(userId=USER(),{handoffId,participant}={}){return serialized(userId,async()=>{
  const state=await load(userId),handoff=state.handoffs.find(row=>row.id===handoffId);if(!handoff)return null;if(handoff.to!==participant)throw new Error("handoff may only be acknowledged by its assignee");
  if(handoff.status==="acknowledged")return clone(handoff);handoff.status="acknowledged";handoff.acknowledgedAt=now();handoff.updatedAt=now();await save(userId,state);return clone(handoff);
});}

function callbackPayload(input={}){
  return{objectiveId:bounded(input.objectiveId,80),from:bounded(input.from,100),to:bounded(input.to,100),type:bounded(input.type||"result",80),status:bounded(input.status||"available",80),summary:bounded(input.summary,5000),evidenceRefs:Array.isArray(input.evidenceRefs)?input.evidenceRefs.map(v=>bounded(v,300)).filter(Boolean).slice(0,200):[],deliveryMode:bounded(input.deliveryMode||"pull",80),metadata:input.metadata&&typeof input.metadata==="object"&&!Array.isArray(input.metadata)?clone(input.metadata):{}};
}
function safeDeliveryReceipt(receipt={}){return{ok:Boolean(receipt?.ok),readBackConfirmed:Boolean(receipt?.readBackConfirmed),commentId:receipt?.commentId??null,url:bounded(receipt?.url,1000)||null,attempts:Math.max(0,Number(receipt?.attempts||0)),writeAttempts:Math.max(0,Number(receipt?.writeAttempts||0)),deduplicated:Boolean(receipt?.deduplicated),errors:Array.isArray(receipt?.errors)?receipt.errors.map(v=>bounded(typeof v==="string"?v:v?.message||v?.code||JSON.stringify(v),500)).filter(Boolean).slice(-20):[]};}
export function recordCallback(userId=USER(),input={}){return serialized(userId,async()=>{
  const state=await load(userId),payload=callbackPayload(input),idempotencyKey=bounded(input.idempotencyKey,220)||null,deliveryHash=digest(payload);
  let callback=idempotencyKey?state.callbacks.find(row=>row.idempotencyKey===idempotencyKey):null;
  if(callback){const changed=callback.deliveryHash!==deliveryHash;if(!changed)return clone(callback);Object.assign(callback,payload,{deliveryHash,updatedAt:now()});callback.deliveryRevision=Number(callback.deliveryRevision||1)+1;callback.revisionDeliveryAttempts=0;callback.delivered=false;callback.deliveredAt=null;callback.deliveryReadBackConfirmed=false;callback.lastDeliveryError=null;callback.deliveryExhausted=false;callback.deliveryReceipt=null;}
  else{callback={id:crypto.randomUUID(),...payload,idempotencyKey,deliveryHash,deliveryRevision:1,createdAt:now(),updatedAt:now(),delivered:false,deliveredAt:null,deliveryReadBackConfirmed:false,deliveryAttempts:0,revisionDeliveryAttempts:0,lastDeliveryAttemptAt:null,lastDeliveryError:null,deliveryErrors:[],deliveryExhausted:false,deliveryReceipt:null};state.callbacks.push(callback);}
  state.callbacks=state.callbacks.slice(-5000);await save(userId,state);return clone(callback);
});}
export function recordCallbackDelivery(userId=USER(),{callbackId,delivered=false,error=null,receipt=null}={}){return serialized(userId,async()=>{
  const state=await load(userId),callback=state.callbacks.find(row=>row.id===callbackId);if(!callback)return null;
  const safeReceipt=safeDeliveryReceipt(receipt||{}),attemptDelta=Math.max(1,Number(safeReceipt.attempts||1)),confirmed=Boolean(delivered&&safeReceipt.readBackConfirmed);
  callback.deliveryAttempts=Number(callback.deliveryAttempts||0)+attemptDelta;callback.revisionDeliveryAttempts=Number(callback.revisionDeliveryAttempts||0)+attemptDelta;callback.lastDeliveryAttemptAt=now();callback.deliveryReceipt=safeReceipt;callback.deliveryReadBackConfirmed=confirmed;
  if(confirmed){callback.delivered=true;callback.deliveredAt=now();callback.lastDeliveryError=null;callback.deliveryExhausted=false;}
  else{const message=bounded(error||safeReceipt.errors.at(-1)||"Delivery was not confirmed by provider read-back.",1000);callback.delivered=false;callback.lastDeliveryError=message;callback.deliveryErrors=[...(callback.deliveryErrors||[]),{at:now(),message}].slice(-20);callback.deliveryExhausted=callback.revisionDeliveryAttempts>=MAX_CALLBACK_DELIVERY_ATTEMPTS;}
  callback.updatedAt=now();await save(userId,state);return clone(callback);
});}
export async function listPendingCallbacks(userId=USER(),{deliveryMode=null,limit=50}={}){const state=await load(userId),mode=deliveryMode?bounded(deliveryMode,80):null;return state.callbacks.filter(row=>!row.delivered&&!row.deliveryExhausted&&(!mode||row.deliveryMode===mode)).sort((a,b)=>String(a.lastDeliveryAttemptAt||a.createdAt||"").localeCompare(String(b.lastDeliveryAttemptAt||b.createdAt||""))).slice(0,Math.max(1,Math.min(Number(limit)||50,200))).map(clone);}

export async function controlPlaneSnapshot(userId=USER(),{objectiveId=null}={}){
  const state=await load(userId),oid=objectiveId?bounded(objectiveId,80):null;
  return{version:state.version,mission:SHARED_MISSION,participants:state.participants,objectives:oid?state.objectives.filter(row=>row.id===oid):state.objectives.slice(-100),evidence:(oid?state.evidence.filter(row=>row.objectiveId===oid):state.evidence.slice(-300)),commands:(oid?state.commands.filter(row=>row.objectiveId===oid):state.commands.slice(-200)),handoffs:(oid?state.handoffs.filter(row=>row.objectiveId===oid):state.handoffs.slice(-200)),callbacks:(oid?state.callbacks.filter(row=>row.objectiveId===oid):state.callbacks.slice(-200)),locks:state.locks.filter(lock=>Date.parse(lock.expiresAt||0)>Date.now()),receipts:state.receipts.slice(-300),updatedAt:state.updatedAt};
}

export async function prepareObjectiveControlContext(userId,input={}){
  const objective=await ensureObjective(userId,input);
  await registerParticipant(userId,{...PARTICIPANTS.georgie,capabilities:["persistent_execution","background_recovery","governed_tools","evidence_persistence","github_handoff_relay"],callbackMode:"durable_pull",endpointBound:true});
  await registerParticipant(userId,{...PARTICIPANTS.chatgpt,capabilities:["interactive_reasoning","architecture","connected_tool_coordination","code_review","github_handoff_relay"],callbackMode:"conversation_only",endpointBound:false});
  const snapshot=await controlPlaneSnapshot(userId,{objectiveId:objective.id});
  return{objectiveId:objective.id,missionId:SHARED_MISSION.id,objective,snapshot,connectionTruth:{chatgptAutonomousCallback:false,chatgptConversationRequired:true,sharedDurableRelay:"github_handoff_plus_control_plane",openaiApiPeerAvailableOnlyWhenConfigured:true,georgiePersistent:true}};
}
