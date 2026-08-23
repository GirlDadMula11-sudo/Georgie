import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { enqueueEvent } from "./events.js";

const NS="runtime_reliability";
const MAX_FAULTS=250;
const WINDOW_MS=15*60_000;

function now(){return new Date().toISOString();}
function signature(kind,error){return crypto.createHash("sha256").update(`${kind}:${String(error||"unknown").slice(0,500)}`).digest("hex").slice(0,20);}

export async function runtimeReliabilityStatus(userId){
  return readCloudState(String(userId),NS,{faults:[],circuits:{},updatedAt:null});
}

export async function recordRuntimeFault(userId,{kind="unknown",error="unknown",recoverable=true,context={}}={}){
  const uid=String(userId);
  const state=await runtimeReliabilityStatus(uid);
  const sig=signature(kind,error);
  const fault={id:crypto.randomUUID(),signature:sig,kind,error:String(error).slice(0,1000),recoverable:Boolean(recoverable),context,observedAt:now()};
  const faults=[...(Array.isArray(state.faults)?state.faults:[]),fault].slice(-MAX_FAULTS);
  const recent=faults.filter(item=>item.signature===sig&&Date.now()-Date.parse(item.observedAt)<WINDOW_MS);
  const circuits={...(state.circuits||{}),[kind]:recent.length>=3?{state:"open",signature:sig,count:recent.length,openedAt:now()}:{state:"closed",signature:sig,count:recent.length}};
  await writeCloudState(uid,NS,{...state,faults,circuits,updatedAt:now()});
  if(recent.length===1||recent.length===3){
    await enqueueEvent({userId:uid,type:"runtime.reliability_fault",title:recent.length>=3?"Georgie isolated a recurring runtime defect":"Georgie recovered from a runtime defect",body:recent.length>=3?`${kind} failed ${recent.length} times in the current window. The failing path is circuit-broken and queued for repair.`:`${kind} failed once and the user-facing turn was recovered through the safe fallback.`,priority:recent.length>=3?"high":"normal",dedupeKey:`runtime-fault:${sig}:${recent.length>=3?"recurring":"first"}`,data:{signature:sig,kind,count:recent.length,recoverable:Boolean(recoverable)}}).catch(()=>{});
  }
  return {signature:sig,count:recent.length,circuit:circuits[kind]};
}

export async function circuitOpen(userId,kind){
  const state=await runtimeReliabilityStatus(userId);
  return state?.circuits?.[kind]?.state==="open";
}
