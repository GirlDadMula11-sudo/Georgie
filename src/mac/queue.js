import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { readCloudState, writeCloudState, cloudStateStatus } from "../cloud-state.js";

const NS = "mac_jobs_v2";
const PRIMARY = () => process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const memoryStores = new Map();
const cloudRefreshes = new Map();
const cloudRefreshCompletedAt = new Map();
const cloudMirrorStates = new Map();
const cloudMirrorTimers = new Map();
const cloudMirrorInFlight = new Map();
const mutationLocks = new Map();
let resolvedDataDir = null;
let storageMode = "unresolved";
const CLOUD_REFRESH_INTERVAL_MS = Math.max(10_000, Math.min(300_000, Number(process.env.GEORGIE_MAC_QUEUE_CLOUD_REFRESH_MS || 60_000)));
const RECEIPT_DEADLINE_MS = Math.max(2_000, Math.min(60_000, Number(process.env.GEORGIE_MAC_RECEIPT_DEADLINE_MS || 10_000)));
const CLAIM_LEASE_MS = Math.max(5_000, Math.min(300_000, Number(process.env.GEORGIE_MAC_CLAIM_LEASE_MS || 45_000)));
const LONG_RUNNING_MAC_ACTIONS=new Set(["roblox.install_rojo_and_build","roblox.play_test_validate"]);
const MAKAYLA_PLAY_TEST_RECOVERY={jobId:"idem-cb7e9b3ba3d078186977ba33a5a18acc371cb90f",deviceId:"primary-mac",action:"roblox.play_test_validate",projectRoot:"/Users/mac/Documents/Georgie Roblox Projects/makayla-horror-prototype",requiredAgentVersion:"2.2.62"};
function claimLeaseMs(job){return LONG_RUNNING_MAC_ACTIONS.has(String(job?.action||""))?15*60_000:CLAIM_LEASE_MS;}

function safeUserId(userId) { return String(userId || PRIMARY()).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "primary"; }
function retainJobs(jobs,recentLimit){
  const source=Array.isArray(jobs)?jobs:[],recent=source.slice(-recentLimit),keep=new Set(recent.map(job=>job?.id).filter(Boolean));
  for(const job of source)if(job?.retention==="pinned"&&LONG_RUNNING_MAC_ACTIONS.has(String(job?.action||""))&&job?.id)keep.add(job.id);
  return source.filter(job=>keep.has(job?.id));
}
export function compactJobStore(store){
  const jobs=retainJobs(store?.jobs,500);
  const newestCapture=[...jobs].reverse().find(job=>job?.action==="screen.capture"&&typeof job?.result?.base64==="string")?.id||null;
  return {jobs:jobs.map(job=>{
    const next={...job,error:typeof job?.error==="string"?job.error.slice(0,4000):job?.error};
    if(job?.action==="screen.capture"&&typeof job?.result?.base64==="string"&&job.id!==newestCapture){
      const base64=job.result.base64;
      next.result={...job.result,base64:null,base64Omitted:{characters:base64.length,digest:crypto.createHash("sha256").update(base64).digest("hex")}};
    }
    return next;
  })};
}
function candidateDataDirs() { const configured=String(process.env.GEORGIE_DATA_DIR||"").trim(); const candidates=[configured?path.resolve(configured,"mac-jobs"):null,path.resolve(process.cwd(),"data","mac-jobs"),path.resolve(os.tmpdir(),"georgie-data","mac-jobs")].filter(Boolean); return [...new Set(candidates)]; }
async function ensureWritableDir(){if(resolvedDataDir)return resolvedDataDir;for(const dir of candidateDataDirs()){try{await fs.mkdir(dir,{recursive:true,mode:0o700});const probe=path.join(dir,`.write-probe-${process.pid}-${Date.now()}`);await fs.writeFile(probe,"ok",{mode:0o600});await fs.unlink(probe).catch(()=>{});resolvedDataDir=dir;storageMode=dir.includes(os.tmpdir())?"runtime_temp":"local_disk";return resolvedDataDir}catch(error){console.warn(`Mac queue storage candidate unavailable (${dir}):`,error instanceof Error?error.message:error)}}storageMode="memory";return null}
async function localPath(userId){const dir=await ensureWritableDir();return dir?path.join(dir,`${safeUserId(userId)}.json`):null}
function readMemoryStore(userId){const value=memoryStores.get(safeUserId(userId));return{jobs:Array.isArray(value?.jobs)?structuredClone(value.jobs):[]}}
function writeMemoryStore(userId,store){memoryStores.set(safeUserId(userId),structuredClone(compactJobStore(store)))}
async function readLocalStore(userId){const target=await localPath(userId);if(!target)return readMemoryStore(userId);try{const parsed=JSON.parse(await fs.readFile(target,"utf8"));return{jobs:Array.isArray(parsed?.jobs)?parsed.jobs:[]}}catch(error){if(error?.code!=="ENOENT")console.warn("Mac job local read failed:",error instanceof Error?error.message:error);const memory=readMemoryStore(userId);return memory.jobs.length?memory:{jobs:[]}}}
async function writeLocalStore(userId,store){store=compactJobStore(store);writeMemoryStore(userId,store);const target=await localPath(userId);if(!target)return false;try{const temp=`${target}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(temp,JSON.stringify({jobs:Array.isArray(store?.jobs)?store.jobs:[]}),{mode:0o600});await fs.rename(temp,target);return true}catch(error){console.warn("Mac job disk write failed; in-memory queue remains active:",error instanceof Error?error.message:error);resolvedDataDir=null;storageMode="memory";return false}}
function macJobLifecycleMs(job){
  const timestamps=[job?.createdAt,job?.availableAt,job?.claimedAt,job?.dispatchReceipt?.claimedAt,job?.completedAt];
  if(job?.status==="dead_letter")timestamps.push(job?.alert?.raisedAt);
  return Math.max(0,...timestamps.map(value=>{const ms=new Date(value||0).getTime();return Number.isFinite(ms)?ms:0}));
}
function macJobStateRank(job){return ({completed:6,failed:5,dead_letter:5,claimed:4,queued:3}[String(job?.status||"")]||0);}
function fresherMacJob(a,b){
  const at=macJobLifecycleMs(a),bt=macJobLifecycleMs(b);
  if(at!==bt)return at>bt?a:b;
  const aa=Number(a?.attempts||0),ba=Number(b?.attempts||0);
  if(aa!==ba)return aa>ba?a:b;
  const ar=macJobStateRank(a),br=macJobStateRank(b);
  if(ar!==br)return ar>br?a:b;
  return b||a;
}
function mergeStores(localStore,cloudStore){
  const byId=new Map();
  for(const job of [...(cloudStore?.jobs||[]),...(localStore?.jobs||[])]){
    if(!job?.id)continue;
    const prior=byId.get(job.id);
    byId.set(job.id,prior?fresherMacJob(prior,job):job);
  }
  return{jobs:retainJobs([...byId.values()].sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))),5000)};
}
export function macQueueCloudRefreshPolicy(){return{mode:"durable_claim_reconciliation",intervalMs:CLOUD_REFRESH_INTERVAL_MS,foregroundPollReadsCloud:true,mutationsMirrorCloud:"asynchronous_coalesced_with_synchronous_claim_completion",refreshCoalesced:true,unchangedPollWrites:false}}
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
function scheduleCloudMirror(uid,store){if(!cloudStateStatus().enabled||cloudStateStatus().providerCircuitOpen)return;store=compactJobStore(store);cloudMirrorStates.set(uid,structuredClone(store));if(cloudMirrorTimers.has(uid)||cloudMirrorInFlight.has(uid))return;const delay=cloudStateStatus().degraded?CLOUD_REFRESH_INTERVAL_MS:0;const timer=setTimeout(()=>{cloudMirrorTimers.delete(uid);const latest=cloudMirrorStates.get(uid);const work=writeCloudState(uid,NS,latest).then(mirrored=>{if(!mirrored)console.warn("Mac job cloud mirror unavailable; local/runtime queue remains active.")}).catch(error=>console.warn("Mac job cloud mirror deferred:",error instanceof Error?error.message:error)).finally(()=>{cloudMirrorInFlight.delete(uid);if(JSON.stringify(cloudMirrorStates.get(uid))!==JSON.stringify(latest))scheduleCloudMirror(uid,cloudMirrorStates.get(uid));});cloudMirrorInFlight.set(uid,work);},delay);timer.unref?.();cloudMirrorTimers.set(uid,timer)}
async function writeStore(userId,store){const uid=safeUserId(userId);await writeLocalStore(uid,store);scheduleCloudMirror(uid,store)}
async function mutateStore(userId,mutation,{durableClaimBoundary=false}={}){
  const uid=safeUserId(userId);const prior=mutationLocks.get(uid)||Promise.resolve();
  const next=prior.catch(()=>{}).then(async()=>{
    let store=await readStore(uid);
    if(durableClaimBoundary&&cloudStateStatus().enabled){
      const cloud=await readCloudState(uid,NS,{jobs:[]});
      store=mergeStores(cloud,store);
      await writeLocalStore(uid,store);
    }
    const before=JSON.stringify(store),result=await mutation(store);
    if(JSON.stringify(store)!==before){
      await writeLocalStore(uid,store);
      if(durableClaimBoundary&&cloudStateStatus().enabled)await writeCloudState(uid,NS,store);
      else scheduleCloudMirror(uid,store);
    }
    return result;
  });
  const tracked=next.finally(()=>{if(mutationLocks.get(uid)===tracked)mutationLocks.delete(uid)});tracked.catch(()=>{});mutationLocks.set(uid,tracked);return next;
}
export function macQueueStorageStatus(){return{mode:storageMode,path:resolvedDataDir,cloudMirror:cloudStateStatus().enabled,cloudRefresh:macQueueCloudRefreshPolicy()}}

// All physical Mac jobs live in the primary device queue. requestedByUserId preserves the browser/user origin.
export async function enqueueMacJob({userId,deviceId,action,args={},risk="low_risk_write",reason="",idempotencyKey=null,approvalId=null,planId=null,maxAttempts=5}){
  const requestedByUserId=safeUserId(userId||PRIMARY());
  const queueUserId=safeUserId(PRIMARY());
  const key=String(idempotencyKey||"").trim().slice(0,240)||null;
  return mutateStore(queueUserId,store=>{
    const existing=key?store.jobs.find(job=>job.idempotencyKey===key):null;if(existing){
      if(existing.status==="dead_letter"&&LONG_RUNNING_MAC_ACTIONS.has(String(action||""))&&existing.action===action){const resumedAt=new Date().toISOString();existing.resumeHistory=[...(existing.resumeHistory||[]),{resumedAt,fromStatus:existing.status,error:existing.error,attempts:existing.attempts,reason:"long_running_checkpoint_transport_repaired"}].slice(-20);existing.args=structuredClone(args||{});existing.status="queued";existing.attempts=0;existing.maxAttempts=Math.max(1,Math.min(5,Number(maxAttempts)||5));existing.availableAt=resumedAt;existing.claimedAt=null;existing.claimLeaseExpiresAt=null;existing.completedAt=null;existing.result=null;existing.error=null;existing.alert=null;existing.resumeCount=Number(existing.resumeCount||0)+1;}return existing;
    }
    const acceptedAt=new Date().toISOString(),jobId=key?`idem-${crypto.createHash("sha256").update(key).digest("hex").slice(0,40)}`:crypto.randomUUID();
    const job={id:jobId,userId:queueUserId,requestedByUserId,deviceId,action,args,risk,reason,idempotencyKey:key,approvalId,planId,retention:LONG_RUNNING_MAC_ACTIONS.has(String(action||""))?"pinned":undefined,status:"queued",attempts:0,maxAttempts:Math.max(1,Math.min(5,Number(maxAttempts)||5)),createdAt:acceptedAt,availableAt:acceptedAt,claimedAt:null,claimLeaseExpiresAt:null,completedAt:null,result:null,error:null,dispatchReceipt:{id:crypto.randomUUID(),jobId,idempotencyKey:key,acceptedAt,claimedAt:null,deviceId:null},alert:null};
    store.jobs.push(job);store.jobs=retainJobs(store.jobs,5000);return job;
  },{durableClaimBoundary:true});
}
export async function importRecoveredMacJob(input){
  const job=structuredClone(input||{}),uid=safeUserId(PRIMARY());
  if(!/^idem-[a-f0-9]{40}$/.test(String(job.id||"")))throw new Error("MAC_RECOVERY_IMPORT_ID_INVALID");
  if(job.userId!==uid||job.deviceId!=="primary-mac"||job.action!=="mailbox.read_only_backfill"||job.risk!=="read")throw new Error("MAC_RECOVERY_IMPORT_SCOPE_REJECTED");
  if(job.args?.authority!=="read_only"||!String(job.args?.objectiveId||"")||Number(job.args?.recoveryGeneration)!==1||!/^idem-[a-f0-9]{40}$/.test(String(job.args?.recoveryRootJobId||"")))throw new Error("MAC_RECOVERY_IMPORT_LINEAGE_INVALID");
  if(job.status!=="queued"||Number(job.attempts)!==0||job.claimedAt!==null||job.completedAt!==null||job.result!==null||job.error!==null)throw new Error("MAC_RECOVERY_IMPORT_STATE_REJECTED");
  return mutateStore(uid,store=>{const existing=store.jobs.find(item=>item.id===job.id);if(existing){if(JSON.stringify(existing)!==JSON.stringify(job))throw new Error("MAC_RECOVERY_IMPORT_CONFLICT");return existing;}store.jobs.push(job);store.jobs=retainJobs(store.jobs,5000);return job;});
}
export async function repairRecoveredMailboxPayload(deviceId,jobId,{objectiveId,operation,mailboxes,batchLimit=25}={}){
  const uid=safeUserId(PRIMARY()),scope=(Array.isArray(mailboxes)?mailboxes:[]).map(value=>String(value).toLowerCase());
  if(operation!=="connection_verify_and_backfill"||scope.length!==2||!scope.includes("submissions@sierramarketinginc.com")||!scope.includes("jasonsierra@sierramarketinginc.com"))throw new Error("MAC_RECOVERY_PAYLOAD_SCOPE_REJECTED");
  return mutateStore(uid,store=>{const job=store.jobs.find(item=>item.id===String(jobId)&&item.deviceId===String(deviceId));if(!job)return null;if(job.action!=="mailbox.read_only_backfill"||job.risk!=="read"||job.args?.authority!=="read_only"||job.args?.objectiveId!==String(objectiveId)||Number(job.args?.recoveryGeneration)!==1)throw new Error("MAC_RECOVERY_PAYLOAD_LINEAGE_REJECTED");if(job.status!=="failed"||job.error!=="MAILBOX_BRIDGE_AUTHORIZATION_FAILED")throw new Error(`MAC_RECOVERY_PAYLOAD_NOT_REPAIRABLE: ${job.status}`);const repairedAt=new Date().toISOString();job.repairHistory=[...(job.repairHistory||[]),{repairedAt,fromStatus:job.status,error:job.error,attempts:job.attempts,reason:"missing_read_only_mailbox_scope_repaired"}].slice(-20);job.args={...job.args,operation,mailboxes:scope,batchLimit:Math.min(25,Math.max(1,Number(batchLimit)||25))};job.status="queued";job.availableAt=repairedAt;job.claimedAt=null;job.claimLeaseExpiresAt=null;job.completedAt=null;job.result=null;job.error=null;job.alert=null;job.maxAttempts=Math.max(Number(job.maxAttempts||5),Number(job.attempts||0)+1);return job;});
}
export async function reconcileMacDispatches({nowMs=Date.now()}={}){const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const now=Number(nowMs)||Date.now(),alerts=[];for(const job of store.jobs){if(job.status==="claimed"&&job.claimLeaseExpiresAt&&new Date(job.claimLeaseExpiresAt).getTime()<=now){job.status=job.attempts>=job.maxAttempts?"dead_letter":"queued";job.availableAt=new Date(now+Math.min(30_000,1_000*2**Math.min(job.attempts,5))).toISOString();job.claimedAt=null;job.claimLeaseExpiresAt=null;job.error="Mac claim lease expired before a completion receipt";}const dueAt=new Date(job.availableAt||job.createdAt).getTime()+RECEIPT_DEADLINE_MS;if(job.status==="queued"&&now>=dueAt&&!job.alert){job.alert={code:"MAC_DISPATCH_RECEIPT_MISSING",raisedAt:new Date(now).toISOString(),jobId:job.id,approvalId:job.approvalId,planId:job.planId,deadlineMs:RECEIPT_DEADLINE_MS};alerts.push(job.alert);}if(job.status==="dead_letter"&&!job.alert){job.alert={code:"MAC_DELIVERY_EXHAUSTED",raisedAt:new Date(now).toISOString(),jobId:job.id,approvalId:job.approvalId,planId:job.planId,attempts:job.attempts};alerts.push(job.alert);}}return alerts;});}
function macClaimScore(job, nowMs){
  const action=String(job?.action||"");
  const risk=String(job?.risk||"");
  const availableMs=new Date(job?.availableAt||job?.createdAt||0).getTime();
  const ageMs=Number.isFinite(availableMs)?Math.max(0,Number(nowMs)-availableMs):0;
  const base=action==="developer.repo_inspect"?0:action==="developer.file_read"?5000:risk==="read"?10000:20000;
  return base-Math.min(ageMs,30000);
}
export function agentVersionEligible(job,agentVersion){const required=String(job?.args?.requiredAgentVersion||"").trim();return !required||String(agentVersion||"").trim()===required;}
function restoreApprovedMakaylaPlayTestIdentity(store,uid,deviceId,jobId,{expectedAction,requiredAgentVersion,governance}={}){
  const exact=MAKAYLA_PLAY_TEST_RECOVERY;
  if(String(jobId)!==exact.jobId||String(deviceId)!==exact.deviceId||String(expectedAction)!==exact.action||String(requiredAgentVersion)!==exact.requiredAgentVersion)return null;
  const planId=String(governance?.planId||""),approvalId=String(governance?.approvalId||"");
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const idempotencyKey=`approval:${approvalId}:plan:${planId}`;
  if(!uuid.test(planId)||!uuid.test(approvalId)||String(governance?.idempotencyKey||"")!==idempotencyKey)throw new Error("MAC_LONG_RUNNING_RESTORATION_APPROVAL_REJECTED");
  const restoredAt=new Date().toISOString();
  const job={id:exact.jobId,userId:uid,requestedByUserId:uid,deviceId:exact.deviceId,action:exact.action,args:{projectRoot:exact.projectRoot,requiredAgentVersion:exact.requiredAgentVersion},risk:"sensitive_write",reason:"Restore the approved preserved Makayla play-test identity after queue-ledger loss",idempotencyKey,approvalId,planId,retention:"pinned",status:"queued",attempts:0,maxAttempts:5,createdAt:restoredAt,availableAt:restoredAt,claimedAt:null,claimLeaseExpiresAt:null,completedAt:null,result:null,error:null,alert:null,resumeCount:1,resumeHistory:[{resumedAt:restoredAt,fromStatus:"ledger_missing",error:"MAC_JOB_NOT_FOUND",attempts:0,reason:"play_test_job_ledger_restored_for_exact_identity_recovery"}],restorationReceipt:{restoredAt,jobId:exact.jobId,planId,approvalId,identityPreserved:true,newJobIdCreated:false},dispatchReceipt:{id:`restore:${exact.jobId}`,jobId:exact.jobId,idempotencyKey,acceptedAt:restoredAt,claimedAt:null,deviceId:null}};
  store.jobs.push(job);store.jobs=retainJobs(store.jobs,5000);return job;
}
export async function recoverLongRunningMacJob(deviceId,jobId,{expectedAction,requiredAgentVersion,governance}={}){const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const action=String(expectedAction||"");if(!LONG_RUNNING_MAC_ACTIONS.has(action))throw new Error("MAC_LONG_RUNNING_RECOVERY_SCOPE_REJECTED");if(!/^2\.2\.\d+$/.test(String(requiredAgentVersion||"")))throw new Error("MAC_LONG_RUNNING_RECOVERY_VERSION_INVALID");let job=store.jobs.find(item=>item.id===String(jobId)&&item.deviceId===String(deviceId));if(!job)job=restoreApprovedMakaylaPlayTestIdentity(store,uid,deviceId,jobId,{expectedAction:action,requiredAgentVersion,governance});if(!job)return null;if(job.action!==action)throw new Error("MAC_LONG_RUNNING_RECOVERY_SCOPE_REJECTED");job.retention="pinned";if(job.status==="queued"&&job.args?.requiredAgentVersion===String(requiredAgentVersion))return job;const markerOnlyPlayTestFailure=action==="roblox.play_test_validate"&&job.status==="completed"&&job.result?.status==="blocked"&&Array.isArray(job.result?.defects)&&job.result.defects.length===1&&job.result.defects[0]==="RUNTIME_PROTOTYPE_MARKER_NOT_OBSERVED";const windowOnlyPlayTestFailure=action==="roblox.play_test_validate"&&job.status==="completed"&&job.result?.status==="blocked"&&Array.isArray(job.result?.defects)&&job.result.defects.length===1&&job.result.defects[0]==="ROBLOX_PROTOTYPE_WINDOW_NOT_READY";const screenshotOnlyPlayTestFailure=action==="roblox.play_test_validate"&&job.status==="failed"&&/Command failed: screencapture -x /.test(String(job.error||""));if(job.status==="completed"&&!markerOnlyPlayTestFailure&&!windowOnlyPlayTestFailure)return job;if(job.status==="claimed"&&job.claimLeaseExpiresAt&&new Date(job.claimLeaseExpiresAt).getTime()>Date.now())throw new Error("MAC_LONG_RUNNING_JOB_STILL_ACTIVE");if(!["queued","claimed","failed","dead_letter","completed"].includes(job.status))throw new Error(`MAC_LONG_RUNNING_JOB_NOT_RECOVERABLE: ${job.status}`);const recoveredAt=new Date().toISOString();job.resumeHistory=[...(job.resumeHistory||[]),{resumedAt:recoveredAt,fromStatus:job.status,error:job.error,attempts:job.attempts,reason:windowOnlyPlayTestFailure?"play_test_direct_studio_bridge_repaired":markerOnlyPlayTestFailure?"play_test_exact_artifact_window_repaired":screenshotOnlyPlayTestFailure?"play_test_screenshot_evidence_repaired":"long_running_checkpoint_transport_repaired"}].slice(-20);job.args={...structuredClone(job.args||{}),requiredAgentVersion:String(requiredAgentVersion)};job.status="queued";job.attempts=0;job.maxAttempts=Math.max(1,Math.min(5,Number(job.maxAttempts)||5));job.availableAt=recoveredAt;job.claimedAt=null;job.claimLeaseExpiresAt=null;job.completedAt=null;job.result=null;job.error=null;job.alert=null;job.resumeCount=Number(job.resumeCount||0)+1;return job;},{durableClaimBoundary:true});}
export async function claimMacJobs(deviceId,limit=5,{agentVersion=null}={}){await reconcileMacDispatches();const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const now=new Date(),nowMs=now.getTime(),jobs=store.jobs.filter(j=>(j.deviceId===deviceId||j.deviceId==="primary-mac")&&j.status==="queued"&&new Date(j.availableAt||j.createdAt)<=now&&agentVersionEligible(j,agentVersion)).sort((a,b)=>macClaimScore(a,nowMs)-macClaimScore(b,nowMs)||String(a.createdAt||"").localeCompare(String(b.createdAt||""))).slice(0,limit);for(const job of jobs){job.status="claimed";job.attempts=Number(job.attempts||0)+1;job.claimedAt=now.toISOString();job.claimLeaseExpiresAt=new Date(now.getTime()+claimLeaseMs(job)).toISOString();job.alert=null;if(job.deviceId==="primary-mac"&&deviceId!=="primary-mac"){job.deviceAlias="primary-mac";job.deviceId=deviceId}job.dispatchReceipt={...(job.dispatchReceipt||{}),claimedAt:job.claimedAt,deviceId};}return jobs;},{durableClaimBoundary:true});}
export function isTransientMacDeliveryError(error){return /(?:temporary delivery failure|fetch failed|network|connection (?:reset|refused|closed)|econn(?:reset|refused|aborted)|enotfound|eai_again|headers_timeout|timed? ?out|timeout|http\s*(?:408|425|429|500|502|503|504)|server\s*(?:500|502|503|504))/i.test(String(error||""))}
export async function completeMacJob(deviceId,jobId,{result=null,error=null}={}){const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const job=store.jobs.find(j=>j.id===jobId&&j.deviceId===deviceId);if(!job)return null;if(job.status!=="claimed")throw new Error(`MAC_JOB_NOT_CLAIMED: ${job.status}`);const retry=Boolean(error)&&isTransientMacDeliveryError(error)&&job.attempts<job.maxAttempts;job.status=error?(retry?"queued":"failed"):"completed";job.completedAt=retry?null:new Date().toISOString();job.availableAt=retry?new Date(Date.now()+Math.min(30_000,1_000*2**Math.min(job.attempts,5))).toISOString():job.availableAt;job.claimLeaseExpiresAt=null;job.result=result;job.error=error;return job;},{durableClaimBoundary:true});}
export function versionRecoverableMailboxJob(job){const history=Array.isArray(job.resumeHistory)?job.resumeHistory:[],hadFullBodyRepair=history.some(item=>item?.reason==="neo_full_body_reader_repaired"),hadImmutableIdRepair=history.some(item=>item?.reason==="neo_immutable_id_reader_repaired"),hadRuntimeStateRepair=history.some(item=>item?.reason==="neo_runtime_state_reader_repaired"),hadNetworkCacheRepair=history.some(item=>item?.reason==="neo_network_cache_reader_repaired");if(["failed","dead_letter"].includes(job.status)){const error=String(job.error||"");if(/^Unsupported Mac action: mailbox\.read_only_backfill$/.test(error))return "handler_version_repaired";const hadLegacyReaderRepair=history.some(item=>item?.reason==="legacy_reader_replaced"),hadSingleTabRepair=history.some(item=>item?.reason==="neo_single_tab_reader_repaired"),hadAccountRailRepair=history.some(item=>item?.reason==="neo_account_rail_reader_repaired"),hadEnvelopeBindingRepair=history.some(item=>item?.reason==="neo_envelope_bound_reader_repaired"),exactIdentityFailure=/^NEO_MAILBOX_IDENTITY_NOT_VERIFIED: (submissions|jasonsierra)@sierramarketinginc\.com(?:$|: )/.test(error);if((exactIdentityFailure||/^NEO_(?:READ_ONLY|FULL_BODY)_PROOF_FAILED/.test(error))&&hadEnvelopeBindingRepair&&!hadFullBodyRepair)return "neo_full_body_reader_repaired";if(!exactIdentityFailure||!hadLegacyReaderRepair)return null;if(!hadSingleTabRepair)return "neo_single_tab_reader_repaired";if(!hadAccountRailRepair)return "neo_account_rail_reader_repaired";return !hadEnvelopeBindingRepair?"neo_envelope_bound_reader_repaired":null;}if(job.status!=="completed")return null;const batch=job.result?.mailboxEvidenceBatch,connections=Object.values(job.result?.connection||{});const empty=Array.isArray(batch?.packets)&&batch.packets.length===0&&Object.keys(batch?.cursor||{}).length===0;const legacyMiss=connections.length>0&&connections.every(item=>item?.connected===false&&item?.error==="configured account not found");if(empty&&legacyMiss)return "legacy_reader_replaced";const immutableIdMiss=connections.length>0&&connections.every(item=>item?.connected===true&&item?.provider==="neo_browser"&&item?.readOnly===true&&Array.isArray(item?.rejected)&&item.rejected.includes("missing immutable message id"));if(empty&&immutableIdMiss&&!hadImmutableIdRepair)return "neo_immutable_id_reader_repaired";if(empty&&immutableIdMiss&&hadImmutableIdRepair&&!hadRuntimeStateRepair)return "neo_runtime_state_reader_repaired";if(empty&&immutableIdMiss&&hadRuntimeStateRepair&&!hadNetworkCacheRepair)return "neo_network_cache_reader_repaired";const uncertified=Array.isArray(batch?.packets)&&batch.packets.some(packet=>packet?.bodyComplete!==true||packet?.readStateProof?.neutral!==true);return uncertified&&!hadFullBodyRepair?"neo_full_body_reader_repaired":null;}
export async function resumeFailedMacJob(deviceId,jobId,{objectiveId,expectedAction,verifiedAgentVersion=null}={}){const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const job=store.jobs.find(j=>j.id===jobId&&j.deviceId===deviceId);if(!job)return null;if(String(job.args?.objectiveId||"")!==String(objectiveId||""))throw new Error("MAC_JOB_OBJECTIVE_MISMATCH");if(job.action!==String(expectedAction||""))throw new Error("MAC_JOB_ACTION_MISMATCH");if(job.action!=="mailbox.read_only_backfill"||job.risk!=="read"||job.args?.authority!=="read_only")throw new Error("MAC_JOB_RESUME_SCOPE_REJECTED");const history=Array.isArray(job.resumeHistory)?job.resumeHistory:[];const verifiedVersion=/^2\.2\.(?:[4-9]|1[0-5])$/.test(String(verifiedAgentVersion||""))?String(verifiedAgentVersion):null,verifiedReason=verifiedVersion?`neo_identity_root_${verifiedVersion.replace(/\./g,"_")}_verified`:null;const verifiedUpgrade=Boolean(verifiedReason)&&job.status==="failed"&&/^NEO_MAILBOX_IDENTITY_NOT_VERIFIED:/.test(String(job.error||""))&&!history.some(item=>item?.reason===verifiedReason);const reason=versionRecoverableMailboxJob(job)||(verifiedUpgrade?verifiedReason:null);if(reason){const resumedAt=new Date().toISOString();job.resumeHistory=[...history,{resumedAt,fromStatus:job.status,error:job.error,attempts:job.attempts,completedAt:job.completedAt,resultHash:job.result?crypto.createHash("sha256").update(JSON.stringify(job.result)).digest("hex"):null,reason}].slice(-20);job.status="queued";job.availableAt=resumedAt;job.claimedAt=null;job.claimLeaseExpiresAt=null;job.completedAt=null;job.result=null;job.error=null;job.alert=null;job.maxAttempts=Math.max(Number(job.maxAttempts||5),Number(job.attempts||0)+5);job.resumeCount=Number(job.resumeCount||0)+1;return job;}if(!["failed","dead_letter"].includes(job.status))throw new Error(`MAC_JOB_NOT_RESUMABLE: ${job.status}`);const rootId=String(job.args?.recoveryRootJobId||job.id),generation=Number(job.args?.recoveryGeneration||0)+1;const active=store.jobs.find(item=>String(item.args?.recoveryRootJobId||"")===rootId&&Number(item.args?.recoveryGeneration||0)===generation&&["queued","claimed"].includes(item.status));if(active)return active;const acceptedAt=new Date().toISOString(),key=`${job.idempotencyKey||job.id}:recovery:${generation}`,replacementId=`idem-${crypto.createHash("sha256").update(key).digest("hex").slice(0,40)}`;const lineage={replacesJobId:job.id,recoveryRootJobId:rootId,recoveryGeneration:generation,priorStatus:job.status,priorError:job.error,priorCompletedAt:job.completedAt,priorResultHash:job.result?crypto.createHash("sha256").update(JSON.stringify(job.result)).digest("hex"):null};const replacement={...structuredClone(job),id:replacementId,idempotencyKey:key,args:{...structuredClone(job.args||{}),recoveryRootJobId:rootId,recoveryGeneration:generation,replacesJobId:job.id},status:"queued",attempts:0,maxAttempts:Math.max(1,Math.min(5,Number(job.maxAttempts)||5)),createdAt:acceptedAt,availableAt:acceptedAt,claimedAt:null,claimLeaseExpiresAt:null,completedAt:null,result:null,error:null,alert:null,resumeHistory:[...history,{resumedAt:acceptedAt,fromStatus:job.status,error:job.error,attempts:job.attempts,completedAt:job.completedAt,resultHash:lineage.priorResultHash,reason:"failed_attempt_replaced",replacementJobId:replacementId,generation}].slice(-20),replacementOf:lineage,dispatchReceipt:{id:crypto.randomUUID(),jobId:replacementId,idempotencyKey:key,acceptedAt,claimedAt:null,deviceId:null}};store.jobs.push(replacement);store.jobs=store.jobs.slice(-5000);return replacement;});}
export async function checkpointMacJob(deviceId,jobId,checkpoint){const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const job=store.jobs.find(j=>j.id===jobId&&j.deviceId===deviceId&&j.status==="claimed");if(!job)return null;const next=Number(checkpoint?.nextStep)||0;if(next<Number(job.workflowCheckpoint?.nextStep||0))throw new Error("Workflow checkpoint cannot move backward");const prior=Array.isArray(job.workflowCheckpoint?.receipts)?job.workflowCheckpoint.receipts:[],receipt=checkpoint?.receipt||null,updatedAt=new Date();job.workflowCheckpoint={nextStep:next,stepId:String(checkpoint?.stepId||"").slice(0,120),receipt,receipts:receipt?[...prior.filter(item=>item?.stepId!==receipt.stepId),receipt].slice(-40):prior,updatedAt:updatedAt.toISOString()};job.claimLeaseExpiresAt=new Date(updatedAt.getTime()+claimLeaseMs(job)).toISOString();return job;},{durableClaimBoundary:true});}
export async function listMacJobs(userId,limit=50){const requested=safeUserId(userId||PRIMARY());const primary=safeUserId(PRIMARY());const store=await readStore(primary);return store.jobs.filter(j=>requested===primary||j.requestedByUserId===requested||j.userId===requested).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit)}
