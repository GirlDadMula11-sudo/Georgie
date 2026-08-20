import "dotenv/config";
import crypto from "node:crypto";

const base=String(process.env.GEORGIE_SUPABASE_URL||"").replace(/\/$/,""),key=String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY||"");
if(!base||!key)throw new Error("GEORGIE_SUPABASE_URL and GEORGIE_SUPABASE_SERVICE_ROLE_KEY are required");
const code=crypto.randomBytes(9).toString("base64url").toUpperCase(),codeHash=crypto.createHash("sha256").update(code).digest("hex"),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
const response=await fetch(`${base}/rest/v1/georgie_mobile_enrollment_codes`,{method:"POST",headers:{"content-type":"application/json",apikey:key,authorization:`Bearer ${key}`,prefer:"return=minimal"},body:JSON.stringify({code_hash:codeHash,active:true,expires_at:expiresAt})});
if(!response.ok)throw new Error(`Enrollment code creation failed (${response.status}): ${(await response.text()).slice(0,200)}`);
console.log(`One-time enrollment code: ${code}`);console.log(`Expires: ${expiresAt}`);
