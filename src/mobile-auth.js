import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const base=String(process.env.GEORGIE_SUPABASE_URL||"").replace(/\/$/,"");
const key=String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY||"");
const enabled=Boolean(base&&key);
const headers={"content-type":"application/json",apikey:key,authorization:`Bearer ${key}`};
const hash=v=>crypto.createHash("sha256").update(String(v||"")).digest("hex");
const cacheTtlMs=Math.max(5*60_000,Math.min(24*60*60_000,Number(process.env.GEORGIE_NATIVE_AUTH_CACHE_TTL_MS||12*60*60_000)));
const providerCooldownMs=Math.max(5_000,Math.min(5*60_000,Number(process.env.GEORGIE_NATIVE_AUTH_PROVIDER_COOLDOWN_MS||30_000)));
const cachePath=path.resolve(process.env.GEORGIE_DATA_DIR||path.join(os.tmpdir(),"georgie-data"),"native-auth-cache.json");
let cacheLoaded=false,providerUnavailableUntil=0;const verifiedDevices=new Map();

async function loadCache(){if(cacheLoaded)return;cacheLoaded=true;try{const parsed=JSON.parse(await fs.readFile(cachePath,"utf8"));for(const item of parsed.items||[])if(item?.tokenHash&&item?.device?.device_id&&Date.now()-new Date(item.verifiedAt).getTime()<cacheTtlMs)verifiedDevices.set(item.tokenHash,item);}catch(error){if(error?.code!=="ENOENT")console.warn("Native auth cache read failed:",error instanceof Error?error.message:error);}}
async function persistCache(){try{await fs.mkdir(path.dirname(cachePath),{recursive:true,mode:0o700});const target=`${cachePath}.${process.pid}.${Date.now()}.tmp`,items=[...verifiedDevices.values()].filter(item=>Date.now()-new Date(item.verifiedAt).getTime()<cacheTtlMs);await fs.writeFile(target,JSON.stringify({version:1,items}),{mode:0o600});await fs.rename(target,cachePath);}catch(error){console.warn("Native auth cache write failed:",error instanceof Error?error.message:error);}}
function cachedDevice(tokenHash){const item=verifiedDevices.get(tokenHash);if(!item)return null;if(Date.now()-new Date(item.verifiedAt).getTime()>=cacheTtlMs){verifiedDevices.delete(tokenHash);return null;}return structuredClone(item.device);}

async function rest(path,options={}){if(!enabled)throw new Error("Native auth store unavailable");const r=await fetch(`${base}/rest/v1/${path}`,{...options,signal:options.signal||AbortSignal.timeout(4000),headers:{...headers,...(options.headers||{})}});const text=await r.text();if(!r.ok)throw new Error(`Native auth store failed (${r.status}): ${text.slice(0,250)}`);return text?JSON.parse(text):null;}

export function nativeAuthStatus(){return{enabled,providerIndependentVerifiedDeviceFallback:true,cacheTtlMs,rawTokensPersisted:false};}

export async function createEnrollmentCode({ttlMinutes=15}={}){
 const ttl=Math.max(1,Math.min(30,Number(ttlMinutes)||15));
 const code=crypto.randomBytes(9).toString("base64url").toUpperCase();
 const expiresAt=new Date(Date.now()+ttl*60*1000).toISOString();
 await rest("georgie_mobile_enrollment_codes",{method:"POST",headers:{prefer:"return=minimal"},body:JSON.stringify({code_hash:hash(code),active:true,expires_at:expiresAt})});
 return{code,expiresAt,oneTime:true};
}

export async function enrollNativeDevice({code,deviceId,deviceName="iPhone",platform="ios"}){
 if(!code||!deviceId)throw new Error("Enrollment code and device ID are required");
 const codeHash=hash(code),now=new Date().toISOString();
 const rows=await rest(`georgie_mobile_enrollment_codes?code_hash=eq.${encodeURIComponent(codeHash)}&active=eq.true&select=*`,{method:"GET",headers:{prefer:"return=representation"}});
 const row=Array.isArray(rows)?rows[0]:null;
 if(!row||row.used_at||(row.expires_at&&new Date(row.expires_at)<new Date()))throw new Error("Enrollment code is invalid or expired");
 const rawToken=crypto.randomBytes(32).toString("base64url"),tokenHash=hash(rawToken);
 await rest("georgie_mobile_devices?on_conflict=device_id",{method:"POST",headers:{prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({device_id:String(deviceId).slice(0,160),token_hash:tokenHash,device_name:String(deviceName).slice(0,120),platform:String(platform).slice(0,30),last_seen_at:now,revoked_at:null})});
 await rest(`georgie_mobile_enrollment_codes?id=eq.${row.id}`,{method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({used_at:now,used_device_id:String(deviceId).slice(0,160),active:false})});
 const device={device_id:String(deviceId).slice(0,160),device_name:String(deviceName).slice(0,120),platform:String(platform).slice(0,30)};
 await loadCache();verifiedDevices.set(tokenHash,{tokenHash,device,verifiedAt:now});await persistCache();
 return rawToken;
}

export const enrollDevice = enrollNativeDevice;

export async function authenticateNativeRequest(req){
 const auth=String(req.headers.authorization||"");if(!auth.startsWith("Bearer "))return null;
 const raw=auth.slice(7).trim();if(raw.length<24)return null;
 const tokenHash=hash(raw);await loadCache();const cached=cachedDevice(tokenHash);
 if(cached&&Date.now()<providerUnavailableUntil)return cached;
 try{const rows=await rest(`georgie_mobile_devices?token_hash=eq.${encodeURIComponent(tokenHash)}&revoked_at=is.null&select=id,device_id,device_name,platform`,{method:"GET"});const device=Array.isArray(rows)?rows[0]:null;if(!device){verifiedDevices.delete(tokenHash);void persistCache();return null;}providerUnavailableUntil=0;verifiedDevices.set(tokenHash,{tokenHash,device,verifiedAt:new Date().toISOString()});void persistCache();rest(`georgie_mobile_devices?id=eq.${device.id}`,{method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({last_seen_at:new Date().toISOString()})}).catch(()=>{});return device;}catch(error){providerUnavailableUntil=Date.now()+providerCooldownMs;if(cached){console.warn("Native authentication provider unavailable; using recently provider-verified device cache.");return cached;}throw error;}
}
