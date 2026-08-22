import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { readCloudState, writeCloudState, cloudStateStatus } from "../cloud-state.js";

const NS = "mac_jobs";
const PRIMARY = () => process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const memoryStores = new Map();
const cloudRefreshes = new Map();
const cloudRefreshCompletedAt = new Map();
const mutationLocks = new Map();
let resolvedDataDir = null;
let storageMode = "unresolved";
const CLOUD_REFRESH_INTERVAL_MS = Math.max(10_000, Math.min(300_000, Number(process.env.GEORGIE_MAC_QUEUE_CLOUD_REFRESH_MS || 60_000)));
const RECEIPT_DEADLINE_MS = Math.max(2_000, Math.min(60_000, Number(process.env.GEORGIE_MAC_RECEIPT_DEADLINE_MS || 10_000)));
const CLAIM_LEASE_MS = Math.max(5_000, Math.min(300_000, Number(process.env.GEORGIE_MAC_CLAIM_LEASE_MS || 45_000)));

function safeUserId(userId) { return String(userId || PRIMARY()).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "primary"; }
function candidateDataDirs() { const configured=String(process.env.GEORGIE_DATA_DIR||"").trim(); const candidates=[configured?path.resolve(configured,"mac-jobs"):null,path.resolve(process.cwd(),"data","mac-jobs"),path.resolve(os.tmpdir(),"georgie-data","mac-jobs")].filter(Boolean); return [...new Set(candidates)]; }
async function ensureWritableDir(){if(resolvedDataDir)return resolvedDataDir;for(const dir of candidateDataDirs()){try{await fs.mkdir(dir,{recursive:true,mode:0o700});const probe=path.join(dir,`.write-probe-${process.pid}-${Date.now()}`);await fs.writeFile(probe,"ok",{mode:0o600});await fs.unlink(probe).catch(()=>{});resolvedDataDir=dir;storageMode=dir.includes(os.tmpdir())?"runtime_temp":"local_disk";return resolvedDataDir}catch(error){console.warn(`Mac queue storage candidate unavailable (${dir}):`,error instanceof Error?error.message:error)}}storageMode="memory";return null}
async function localPath(userId){const dir=await ensureWritableDir();return dir?path.join(dir,`${safeUserId(userId)}.json`):null}
function readMemoryStore(userId){const value=memoryStores.get(safeUserId(userId));return{jobs:Array.isArray(value?.jobs)?structuredClone(value.jobs):[]}}
function writeMemoryStore(userId,store){memoryStores.set(safeUserId(userId),{jobs:structuredClone(Array.isArray(store?.jobs)?store.jobs:[])})}
async function readLocalStore(userId){const target=await localPath(userId);if(!target)return readMemoryStore(userId);try{const parsed=JSON.parse(await fs.readFile(target,"utf8"));return{jobs:Array.isArray(parsed?.jobs)?parsed.jobs:[]}}catch(error){if(error?.code!=="ENOENT")console.warn("Mac job local read failed:",error instanceof Error?error.message:error);const memory=readMemoryStore(userId);return memory.jobs.length?memory:{jobs:[]}}}
async function writeLocalStore(userId,store){writeMemoryStore(userId,store);const target=await localPath(userId);if(!target)return false;try{const temp=`${target}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(temp,JSON.stringify({jobs:Array.isArray(store?.jobs)?store.jobs:[]}),{mode:0o600});await fs.rename(temp,target);return true}catch(error){console.warn("Mac job disk write failed; in-memory queue remains active:",error instanceof Error?error.message:error);resolvedDataDir=null;storageMode="memory";return false}}
function mergeStores(localStore,cloudStore){const byId=new Map();for(const job of [...(cloudStore?.jobs||[]),...(localStore?.jobs||[])])if(job?.id)byId.set(job.id,job);return{jobs:[...byId.values()].sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))).slice(-5000)}}
export function macQueueCloudRefreshPolicy(){return{mode:"local_hot_path_cloud_reconciliation",intervalMs:CLOUD_REFRESH_INTERVAL_MS,foregroundPollReadsCloud:false,mutationsMirrorCloud:true,refreshCoalesced:true}}
function scheduleCloudRefresh(uid,local){
  if(!cloudStateStatus().enabled||cloudRefreshes.has(uid))return;
  const last=cloudRefreshCompletedAt.get(uid)||0;
  if(Date.now()-last<CLOUD_REFRESH_INTERVAL_MS)return;
  const refresh=(async()=>{const cloud=await readCloudState(uid,NS,{jobs:[]});const latest=await readLocalStore(uid);const merged=mergeStores(mergeStores(local,latest),cloud);if(merged.jobs.length!==latest.jobs.length)await writeLocalStore(uid,merged);})()
    .catch(error=>console.warn("Mac queue cloud reconciliation deferred:",error instanceof Error?error.message:error))
    .finally(()=>{cloudRefreshCompletedAt.set(uid,Date.now());cloudRefreshes.delete(uid)});
  cloudRefreshes.set(uid,refresh);
}
async function readStore(userId=PRIMARY()){const uid=safeUserId(userId);const local=await readLocalStore(uid);scheduleCloudRefresh(uid,local);return local}
async function writeStore(userId,store){const uid=safeUserId(userId);await writeLocalStore(uid,store);if(cloudStateStatus().enabled){const mirrored=await writeCloudState(uid,NS,store);if(!mirrored)console.warn("Mac job cloud mirror unavailable; local/runtime queue remains active.")}}
async function mutateStore(userId,mutation){
  const uid=safeUserId(userId);const prior=mutationLocks.get(uid)||Promise.resolve();
  const next=prior.catch(()=>{}).then(async()=>{const store=await readStore(uid);const result=await mutation(store);await writeStore(uid,store);return result;});
  const tracked=next.finally(()=>{if(mutationLocks.get(uid)===tracked)mutationLocks.delete(uid)});mutationLocks.set(uid,tracked);return next;
}
export function macQueueStorageStatus(){return{mode:storageMode,path:resolvedDataDir,cloudMirror:cloudStateStatus().enabled,cloudRefresh:macQueueCloudRefreshPolicy()}}

// All physical Mac jobs live in the primary device queue. requestedByUserId preserves the browser/user origin.
export async function enqueueMacJob({userId,deviceId,action,args={},risk="low_risk_write",reason="",idempotencyKey=null,approvalId=null,planId=null}){
  const requestedByUserId=safeUserId(userId||PRIMARY());
  const queueUserId=safeUserId(PRIMARY());
  const key=String(idempotencyKey||"").trim().slice(0,240)||null;
  return mutateStore(queueUserId,store=>{
    const existing=key?store.jobs.find(job=>job.idempotencyKey===key):null;if(existing)return existing;
    const acceptedAt=new Date().toISOString(),jobId=key?`idem-${crypto.createHash("sha256").update(key).digest("hex").slice(0,40)}`:crypto.randomUUID();
    const job={id:jobId,userId:queueUserId,requestedByUserId,deviceId,action,args,risk,reason,idempotencyKey:key,approvalId,planId,status:"queued",attempts:0,maxAttempts:5,createdAt:acceptedAt,availableAt:acceptedAt,claimedAt:null,claimLeaseExpiresAt:null,completedAt:null,result:null,error:null,dispatchReceipt:{id:crypto.randomUUID(),jobId,idempotencyKey:key,acceptedAt,claimedAt:null,deviceId:null},alert:null};
    store.jobs.push(job);store.jobs=store.jobs.slice(-5000);return job;
  });
}
export async function reconcileMacDispatches({nowMs=Date.now()}={}){const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const now=Number(nowMs)||Date.now(),alerts=[];for(const job of store.jobs){if(job.status==="claimed"&&job.claimLeaseExpiresAt&&new Date(job.claimLeaseExpiresAt).getTime()<=now){job.status=job.attempts>=job.maxAttempts?"dead_letter":"queued";job.availableAt=new Date(now+Math.min(30_000,1_000*2**Math.min(job.attempts,5))).toISOString();job.claimedAt=null;job.claimLeaseExpiresAt=null;job.error="Mac claim lease expired before a completion receipt";}const dueAt=new Date(job.availableAt||job.createdAt).getTime()+RECEIPT_DEADLINE_MS;if(job.status==="queued"&&now>=dueAt&&!job.alert){job.alert={code:"MAC_DISPATCH_RECEIPT_MISSING",raisedAt:new Date(now).toISOString(),jobId:job.id,approvalId:job.approvalId,planId:job.planId,deadlineMs:RECEIPT_DEADLINE_MS};alerts.push(job.alert);}if(job.status==="dead_letter"&&!job.alert){job.alert={code:"MAC_DELIVERY_EXHAUSTED",raisedAt:new Date(now).toISOString(),jobId:job.id,approvalId:job.approvalId,planId:job.planId,attempts:job.attempts};alerts.push(job.alert);}}return alerts;});}
export async function claimMacJobs(deviceId,limit=5){await reconcileMacDispatches();const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const now=new Date(),jobs=store.jobs.filter(j=>(j.deviceId===deviceId||j.deviceId==="primary-mac")&&j.status==="queued"&&new Date(j.availableAt||j.createdAt)<=now).slice(0,limit);for(const job of jobs){job.status="claimed";job.attempts=Number(job.attempts||0)+1;job.claimedAt=now.toISOString();job.claimLeaseExpiresAt=new Date(now.getTime()+CLAIM_LEASE_MS).toISOString();job.alert=null;if(job.deviceId==="primary-mac"&&deviceId!=="primary-mac"){job.deviceAlias="primary-mac";job.deviceId=deviceId}job.dispatchReceipt={...(job.dispatchReceipt||{}),claimedAt:job.claimedAt,deviceId};}return jobs;});}
export async function completeMacJob(deviceId,jobId,{result=null,error=null}={}){const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const job=store.jobs.find(j=>j.id===jobId&&j.deviceId===deviceId);if(!job)return null;job.status=error?(job.attempts<job.maxAttempts?"queued":"failed"):"completed";job.completedAt=error&&job.status==="queued"?null:new Date().toISOString();job.availableAt=error&&job.status==="queued"?new Date(Date.now()+Math.min(30_000,1_000*2**Math.min(job.attempts,5))).toISOString():job.availableAt;job.claimLeaseExpiresAt=null;job.result=result;job.error=error;return job;});}
export async function checkpointMacJob(deviceId,jobId,checkpoint){const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const job=store.jobs.find(j=>j.id===jobId&&j.deviceId===deviceId&&j.status==="claimed");if(!job)return null;const next=Number(checkpoint?.nextStep)||0;if(next<Number(job.workflowCheckpoint?.nextStep||0))throw new Error("Workflow checkpoint cannot move backward");job.workflowCheckpoint={nextStep:next,stepId:String(checkpoint?.stepId||"").slice(0,120),receipt:checkpoint?.receipt||null,updatedAt:new Date().toISOString()};return job;});}
export async function listMacJobs(userId,limit=50){const requested=safeUserId(userId||PRIMARY());const primary=safeUserId(PRIMARY());const store=await readStore(primary);return store.jobs.filter(j=>requested===primary||j.requestedByUserId===requested||j.userId===requested).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit)}
