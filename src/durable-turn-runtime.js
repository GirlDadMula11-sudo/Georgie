import { readCloudState, writeCloudState } from "./cloud-state.js";

const NAMESPACE="durable_turn_runtime_v1",MAX_JOBS=80;
const live=new Map();

function now(){return new Date().toISOString();}
function safeJob(job){return job?structuredClone(job):null;}
function normalize(value){return{version:1,jobs:Array.isArray(value?.jobs)?value.jobs.filter(Boolean):[]};}
async function state(userId){return normalize(await readCloudState(userId,NAMESPACE,{version:1,jobs:[]}));}
async function persist(userId,job){
  live.set(job.requestId,safeJob(job));
  const current=await state(userId);
  const next={version:1,updatedAt:now(),jobs:[safeJob(job),...current.jobs.filter(item=>item.requestId!==job.requestId)].slice(0,MAX_JOBS)};
  await writeCloudState(userId,NAMESPACE,next);
  return safeJob(job);
}

export async function beginDurableTurn({requestId,userId,sessionId,input,history=[],recoverable=false}){
  const job={requestId,userId,sessionId,input,history:Array.isArray(history)?history.slice(-12):[],recoverable:Boolean(recoverable),status:"accepted",stage:"accepted",message:"Request accepted and durably identified.",createdAt:now(),updatedAt:now(),startedAt:null,completedAt:null,attempts:0,result:null,error:null,progress:[]};
  live.set(requestId,safeJob(job));
  // The local record makes the request immediately addressable. Cloud
  // persistence is bounded and may finish after the first stream event.
  void persist(userId,job).catch(error=>console.warn("Durable turn acceptance persistence deferred:",error instanceof Error?error.message:error));
  return safeJob(job);
}

export async function recordDurableProgress(userId,requestId,event){
  const job=live.get(requestId)||await getDurableTurn(userId,requestId);
  if(!job)return null;
  job.status=event?.stage==="background_queued"?"queued":"running";
  job.stage=event?.stage||event?.type||job.stage;
  job.message=String(event?.message||job.message||"").slice(0,500);
  job.updatedAt=now();
  job.progress=[...(job.progress||[]),{stage:job.stage,message:job.message,tool:event?.tool||null,at:job.updatedAt}].slice(-40);
  live.set(requestId,safeJob(job));
  return job;
}

export async function completeDurableTurn(userId,requestId,result){
  const job=live.get(requestId)||await getDurableTurn(userId,requestId);
  if(!job)return null;
  job.status=result?.completed===false?"blocked":"completed";
  job.stage=job.status;job.result=result;job.error=null;job.completedAt=now();job.updatedAt=job.completedAt;
  return persist(userId,job);
}

export async function failDurableTurn(userId,requestId,error){
  const job=live.get(requestId)||await getDurableTurn(userId,requestId);
  if(!job)return null;
  job.status="blocked";job.stage="blocked";job.error=String(error instanceof Error?error.message:error||"Unknown execution failure").slice(0,800);job.message=`Blocked: ${job.error}`;job.completedAt=now();job.updatedAt=job.completedAt;
  return persist(userId,job);
}

export async function getDurableTurn(userId,requestId){
  if(live.has(requestId))return safeJob(live.get(requestId));
  const current=await state(userId),job=current.jobs.find(item=>item.requestId===requestId)||null;
  if(job)live.set(requestId,safeJob(job));
  return safeJob(job);
}

export async function listRecoverableTurns(userId){
  const current=await state(userId);
  return current.jobs.filter(job=>job.recoverable&&["accepted","queued","running"].includes(job.status));
}

export function runDurableTurn({job,execute,onProgress=()=>{}}){
  const running={...job,status:"running",stage:"running",startedAt:job.startedAt||now(),updatedAt:now(),attempts:Number(job.attempts||0)+1};
  live.set(job.requestId,safeJob(running));
  void persist(job.userId,running).catch(()=>{});
  const progress=event=>{recordDurableProgress(job.userId,job.requestId,event).catch(()=>{});onProgress(event);};
  const operation=Promise.resolve().then(()=>execute({...running,onProgress:progress}));
  operation.then(
    result=>completeDurableTurn(job.userId,job.requestId,result).catch(error=>console.warn("Durable result persistence deferred:",error instanceof Error?error.stack||error.message:error)),
    error=>{console.error(`[Georgie] durable execution failed ${job.requestId}:`,error instanceof Error?error.stack||error.message:error);return failDurableTurn(job.userId,job.requestId,error).catch(()=>{});}
  );
  return operation;
}
