import crypto from "node:crypto";

const base=String(process.env.GEORGIE_SUPABASE_URL||"").replace(/\/$/,"");
const key=String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY||"");
const enabled=Boolean(base&&key);
const headers={"content-type":"application/json",apikey:key,authorization:`Bearer ${key}`};
const hash=v=>crypto.createHash("sha256").update(String(v||"")).digest("hex");

async function rest(path,options={}){if(!enabled)throw new Error("Native auth store unavailable");const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{...headers,...(options.headers||{})}});const text=await r.text();if(!r.ok)throw new Error(`Native auth store failed (${r.status}): ${text.slice(0,250)}`);return text?JSON.parse(text):null;}

export function nativeAuthStatus(){return{enabled};}

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
 return rawToken;
}

export const enrollDevice = enrollNativeDevice;

export async function authenticateNativeRequest(req){
 const auth=String(req.headers.authorization||"");if(!auth.startsWith("Bearer "))return null;
 const raw=auth.slice(7).trim();if(raw.length<24)return null;
 const tokenHash=hash(raw),rows=await rest(`georgie_mobile_devices?token_hash=eq.${encodeURIComponent(tokenHash)}&revoked_at=is.null&select=id,device_id,device_name,platform`,{method:"GET"});
 const device=Array.isArray(rows)?rows[0]:null;if(!device)return null;
 rest(`georgie_mobile_devices?id=eq.${device.id}`,{method:"PATCH",headers:{prefer:"return=minimal"},body:JSON.stringify({last_seen_at:new Date().toISOString()})}).catch(()=>{});
 return device;
}
