import fs from "node:fs";

const path = "src/cloud-state.js";
let source = fs.readFileSync(path, "utf8");
let changed = false;
function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`cloud-state pressure installer missing ${label} anchor`);
  source = source.replace(from, to);
  changed = true;
}

replaceRequired(
  'const PROVIDER_COOLDOWN_MS = boundedNumber(process.env.GEORGIE_CLOUD_STATE_PROVIDER_COOLDOWN_MS, 30_000, 5_000, 600_000);',
  'const PROVIDER_COOLDOWN_MS = boundedNumber(process.env.GEORGIE_CLOUD_STATE_PROVIDER_COOLDOWN_MS, 30_000, 5_000, 600_000);\nconst READ_CACHE_TTL_MS = boundedNumber(process.env.GEORGIE_CLOUD_STATE_READ_CACHE_TTL_MS, 1_000, 100, 5_000);',
  "read cache ttl"
);

replaceRequired(
  'const waiters = [], readsInFlight = new Map(), writesInFlight = new Map(), dirtyRecoveries = new Map(), dirtyRecoveryAttemptedAt = new Map();',
  'const waiters = [], readsInFlight = new Map(), writesInFlight = new Map(), dirtyRecoveries = new Map(), dirtyRecoveryAttemptedAt = new Map(), recentReads = new Map();',
  "recent read cache"
);

replaceRequired(
  'function clone(value){return value==null?value:structuredClone(value);}\nfunction errorMessage(error){return error instanceof Error?error.message:String(error);}',
  'function clone(value){return value==null?value:structuredClone(value);}\nfunction sameState(a,b){try{return JSON.stringify(a)===JSON.stringify(b);}catch{return false;}}\nfunction cacheState(key,state){recentReads.set(key,{state:clone(state),expiresAt:Date.now()+READ_CACHE_TTL_MS});}\nfunction cachedState(key){const row=recentReads.get(key);if(!row)return null;if(row.expiresAt<=Date.now()){recentReads.delete(key);return null;}return clone(row.state);}\nfunction errorMessage(error){return error instanceof Error?error.message:String(error);}',
  "cache helpers"
);

replaceRequired(
  'export function cloudStateStatus(){return {enabled:ENABLED,healthy:ENABLED?!lastError:true,degraded:Boolean(ENABLED&&lastError),lastError,lastSuccessAt,timeoutMs:REQUEST_TIMEOUT_MS,foregroundAttempts:FOREGROUND_ATTEMPTS,recoveryAttempts:MAX_ATTEMPTS,maxConcurrency:MAX_CONCURRENCY,recoveryStorage:storageMode,pendingWrites,dirtyMirrorReadsBlockForeground:false,dirtyRecoveryCooldownMs:DIRTY_RECOVERY_COOLDOWN_MS,providerCircuitOpen:Date.now()<providerUnavailableUntil,providerCooldownMs:PROVIDER_COOLDOWN_MS};}',
  'export function cloudStateStatus(){return {enabled:ENABLED,healthy:ENABLED?!lastError:true,degraded:Boolean(ENABLED&&lastError),lastError,lastSuccessAt,timeoutMs:REQUEST_TIMEOUT_MS,foregroundAttempts:FOREGROUND_ATTEMPTS,recoveryAttempts:MAX_ATTEMPTS,maxConcurrency:MAX_CONCURRENCY,recoveryStorage:storageMode,pendingWrites,dirtyMirrorReadsBlockForeground:false,dirtyRecoveryCooldownMs:DIRTY_RECOVERY_COOLDOWN_MS,providerCircuitOpen:Date.now()<providerUnavailableUntil,providerCooldownMs:PROVIDER_COOLDOWN_MS,readCacheTtlMs:READ_CACHE_TTL_MS,recentReadEntries:recentReads.size,identicalCleanWritesSuppressed:true};}',
  "status contract"
);

replaceRequired(
  'export async function readCloudState(userId,namespace,fallback={}){if(!ENABLED)return clone(fallback);const key=stateKey(userId,namespace);if(readsInFlight.has(key))return clone(await readsInFlight.get(key));const work=(async()=>{const prior=await readMirror(userId,namespace);if(prior?.dirty){scheduleDirtyRecovery(userId,namespace,prior.state);return prior.state;}if(Date.now()<providerUnavailableUntil)return prior?.state&&typeof prior.state==="object"&&!Array.isArray(prior.state)?prior.state:clone(fallback);try{const value=await rpc("georgie_get_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace)});lastError=null;lastSuccessAt=new Date().toISOString();const normalized=value&&typeof value==="object"&&!Array.isArray(value)?value:clone(fallback);await writeMirror(userId,namespace,normalized,false);return normalized;}catch(error){lastError=errorMessage(error);console.warn(`Cloud state read failed for ${namespace}:`,lastError);if(prior?.state&&typeof prior.state==="object"&&!Array.isArray(prior.state))return prior.state;return clone(fallback);}})();readsInFlight.set(key,work);try{return clone(await work);}finally{readsInFlight.delete(key);}}',
  'export async function readCloudState(userId,namespace,fallback={}){if(!ENABLED)return clone(fallback);const key=stateKey(userId,namespace),cached=cachedState(key);if(cached!==null)return cached;if(readsInFlight.has(key))return clone(await readsInFlight.get(key));const work=(async()=>{const prior=await readMirror(userId,namespace);if(prior?.dirty){scheduleDirtyRecovery(userId,namespace,prior.state);cacheState(key,prior.state);return prior.state;}if(Date.now()<providerUnavailableUntil){const value=prior?.state&&typeof prior.state==="object"&&!Array.isArray(prior.state)?prior.state:clone(fallback);cacheState(key,value);return value;}try{const value=await rpc("georgie_get_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace)});lastError=null;lastSuccessAt=new Date().toISOString();const normalized=value&&typeof value==="object"&&!Array.isArray(value)?value:clone(fallback);await writeMirror(userId,namespace,normalized,false);cacheState(key,normalized);return normalized;}catch(error){lastError=errorMessage(error);console.warn(`Cloud state read failed for ${namespace}:`,lastError);const value=prior?.state&&typeof prior.state==="object"&&!Array.isArray(prior.state)?prior.state:clone(fallback);cacheState(key,value);return value;}})();readsInFlight.set(key,work);try{return clone(await work);}finally{readsInFlight.delete(key);}}',
  "read cache path"
);

replaceRequired(
  'async function performWrite(userId,namespace,state){const existing=await readMirror(userId,namespace);const locallyDurable=await writeMirror(userId,namespace,state,true);if(locallyDurable&&!existing?.dirty)pendingWrites+=1;if(Date.now()<providerUnavailableUntil)return locallyDurable;try{await putCloud(userId,namespace,state);return true;}catch(error){lastError=errorMessage(error);console.warn(`Cloud state write deferred for ${namespace}:`,lastError);return locallyDurable;}}',
  'async function performWrite(userId,namespace,state){const key=stateKey(userId,namespace),existing=await readMirror(userId,namespace);if(existing&&sameState(existing.state,state)){cacheState(key,state);if(existing.dirty)scheduleDirtyRecovery(userId,namespace,state);return true;}const locallyDurable=await writeMirror(userId,namespace,state,true);cacheState(key,state);if(locallyDurable&&!existing?.dirty)pendingWrites+=1;if(Date.now()<providerUnavailableUntil)return locallyDurable;try{await putCloud(userId,namespace,state);cacheState(key,state);return true;}catch(error){lastError=errorMessage(error);console.warn(`Cloud state write deferred for ${namespace}:`,lastError);return locallyDurable;}}',
  "identical write suppression"
);

if (changed) fs.writeFileSync(path, source);
if (!source.includes('READ_CACHE_TTL_MS') || !source.includes('identicalCleanWritesSuppressed:true') || !source.includes('sameState(existing.state,state)')) throw new Error("cloud-state pressure installation did not converge");
console.log(`[Georgie] cloud-state pressure hardening installed: changed=${changed}`);
