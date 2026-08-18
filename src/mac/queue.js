import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { readCloudState, writeCloudState, cloudStateStatus } from "../cloud-state.js";

const NS = "mac_jobs";
const PRIMARY = () => process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const memoryStores = new Map();
let resolvedDataDir = null;
let storageMode = "unresolved";

function safeUserId(userId) { return String(userId || PRIMARY()).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "primary"; }
function candidateDataDirs() { const configured=String(process.env.GEORGIE_DATA_DIR||"").trim(); const candidates=[configured?path.resolve(configured,"mac-jobs"):null,path.resolve(process.cwd(),"data","mac-jobs"),path.resolve(os.tmpdir(),"georgie-data","mac-jobs")].filter(Boolean); return [...new Set(candidates)]; }
async function ensureWritableDir(){if(resolvedDataDir)return resolvedDataDir;for(const dir of candidateDataDirs()){try{await fs.mkdir(dir,{recursive:true,mode:0o700});const probe=path.join(dir,`.write-probe-${process.pid}-${Date.now()}`);await fs.writeFile(probe,"ok",{mode:0o600});await fs.unlink(probe).catch(()=>{});resolvedDataDir=dir;storageMode=dir.includes(os.tmpdir())?"runtime_temp":"local_disk";return resolvedDataDir}catch(error){console.warn(`Mac queue storage candidate unavailable (${dir}):`,error instanceof Error?error.message:error)}}storageMode="memory";return null}
async function localPath(userId){const dir=await ensureWritableDir();return dir?path.join(dir,`${safeUserId(userId)}.json`):null}
function readMemoryStore(userId){const value=memoryStores.get(safeUserId(userId));return{jobs:Array.isArray(value?.jobs)?structuredClone(value.jobs):[]}}
function writeMemoryStore(userId,store){memoryStores.set(safeUserId(userId),{jobs:structuredClone(Array.isArray(store?.jobs)?store.jobs:[])})}
async function readLocalStore(userId){const target=await localPath(userId);if(!target)return readMemoryStore(userId);try{const parsed=JSON.parse(await fs.readFile(target,"utf8"));return{jobs:Array.isArray(parsed?.jobs)?parsed.jobs:[]}}catch(error){if(error?.code!=="ENOENT")console.warn("Mac job local read failed:",error instanceof Error?error.message:error);const memory=readMemoryStore(userId);return memory.jobs.length?memory:{jobs:[]}}}
async function writeLocalStore(userId,store){writeMemoryStore(userId,store);const target=await localPath(userId);if(!target)return false;try{const temp=`${target}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(temp,JSON.stringify({jobs:Array.isArray(store?.jobs)?store.jobs:[]}),{mode:0o600});await fs.rename(temp,target);return true}catch(error){console.warn("Mac job disk write failed; in-memory queue remains active:",error instanceof Error?error.message:error);resolvedDataDir=null;storageMode="memory";return false}}
function mergeStores(localStore,cloudStore){const byId=new Map();for(const job of [...(cloudStore?.jobs||[]),...(localStore?.jobs||[])])if(job?.id)byId.set(job.id,job);return{jobs:[...byId.values()].sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))).slice(-5000)}}
async function readStore(userId=PRIMARY()){const uid=safeUserId(userId);const local=await readLocalStore(uid);if(!cloudStateStatus().enabled)return local;const cloud=await readCloudState(uid,NS,{jobs:[]});const merged=mergeStores(local,cloud);if(merged.jobs.length!==local.jobs.length)await writeLocalStore(uid,merged).catch(()=>{});return merged}
async function writeStore(userId,store){const uid=safeUserId(userId);await writeLocalStore(uid,store);if(cloudStateStatus().enabled){const mirrored=await writeCloudState(uid,NS,store);if(!mirrored)console.warn("Mac job cloud mirror unavailable; local/runtime queue remains active.")}}
export function macQueueStorageStatus(){return{mode:storageMode,path:resolvedDataDir,cloudMirror:cloudStateStatus().enabled}}

// All physical Mac jobs live in the primary device queue. requestedByUserId preserves the browser/user origin.
export async function enqueueMacJob({userId,deviceId,action,args={},risk="low_risk_write",reason=""}){
  const requestedByUserId=safeUserId(userId||PRIMARY());
  const queueUserId=safeUserId(PRIMARY());
  const store=await readStore(queueUserId);
  const job={id:crypto.randomUUID(),userId:queueUserId,requestedByUserId,deviceId,action,args,risk,reason,status:"queued",createdAt:new Date().toISOString(),claimedAt:null,completedAt:null,result:null,error:null};
  store.jobs.push(job);store.jobs=store.jobs.slice(-5000);await writeStore(queueUserId,store);return job;
}
export async function claimMacJobs(deviceId,limit=5){const uid=safeUserId(PRIMARY());const store=await readStore(uid);const jobs=store.jobs.filter(j=>(j.deviceId===deviceId||j.deviceId==="primary-mac")&&j.status==="queued").slice(0,limit);const now=new Date().toISOString();for(const job of jobs){job.status="claimed";job.claimedAt=now;if(job.deviceId==="primary-mac"&&deviceId!=="primary-mac"){job.deviceAlias="primary-mac";job.deviceId=deviceId}}if(jobs.length)await writeStore(uid,store);return jobs}
export async function completeMacJob(deviceId,jobId,{result=null,error=null}={}){const uid=safeUserId(PRIMARY());const store=await readStore(uid);const job=store.jobs.find(j=>j.id===jobId&&j.deviceId===deviceId);if(!job)return null;job.status=error?"failed":"completed";job.completedAt=new Date().toISOString();job.result=result;job.error=error;await writeStore(uid,store);return job}
export async function listMacJobs(userId,limit=50){const requested=safeUserId(userId||PRIMARY());const primary=safeUserId(PRIMARY());const store=await readStore(primary);return store.jobs.filter(j=>requested===primary||j.requestedByUserId===requested||j.userId===requested).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit)}
