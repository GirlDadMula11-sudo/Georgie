import "dotenv/config";
import os from "os";
import fs from "fs/promises";
import path from "path";
import { executeLenderPortalSubmit } from "./lender-portal.js";

const BASE=String(process.env.GEORGIE_SERVER_URL||"").replace(/\/$/,"");
const TOKEN=String(process.env.GEORGIE_MAC_AGENT_TOKEN||"");
const DEVICE_ID="primary-mac-portal";
const VERSION="1.0.0";
const POLL_MS=Math.max(1000,Math.min(15000,Number(process.env.GEORGIE_PORTAL_POLL_MS||2000)));
const HEALTH=path.join(os.homedir(),"Library","Application Support","Georgie","portal-agent-health.json");
if(!BASE.startsWith("https://")||TOKEN.length<32)throw new Error("Governed portal agent requires the existing Georgie HTTPS server and pairing token");
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body={}){const r=await fetch(`${BASE}${route}`,{method:"POST",headers:{authorization:`Bearer ${TOKEN}`,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)}),x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||`HTTP ${r.status}`);return x}
async function health(extra={}){await fs.mkdir(path.dirname(HEALTH),{recursive:true,mode:0o700});const payload={deviceId:DEVICE_ID,workerVersion:VERSION,pid:process.pid,successfulCycleAt:new Date().toISOString(),...extra},tmp=`${HEALTH}.${process.pid}.tmp`;await fs.writeFile(tmp,JSON.stringify(payload),{mode:0o600});await fs.rename(tmp,HEALTH)}
async function complete(event,outcome,receipt={},error=null){return api(`/api/mac/${DEVICE_ID}/portal-delivery/${encodeURIComponent(event.event_id)}/complete`,{leaseToken:event.lease_token,outcome,receipt,error})}
async function cycle(){await api(`/api/mac/${DEVICE_ID}/heartbeat`,{hostname:os.hostname(),platform:os.platform(),arch:os.arch(),agentVersion:VERSION,capabilities:["governed_lender_portal_submit"]});const {event}=await api(`/api/mac/${DEVICE_ID}/portal-delivery/claim`,{workerVersion:VERSION});if(!event){await health({lastPollOk:true,claimed:false});return}
 try{const profile=event.portal_profile;if(!profile)throw new Error("CERTIFIED_PORTAL_PROFILE_MISSING");const result=await executeLenderPortalSubmit({endpoint:event.endpoint,portalProfile:profile,placementId:event.placement_id,referralId:event.referral_id,lenderName:event.lender_name});if(result?.providerConfirmed===true)await complete(event,"provider_confirmed",result,null);else if(result?.blocked===true)await complete(event,"blocked",result,result.reason||"Portal execution blocked");else await complete(event,"retry",result||{},"Provider confirmation was not proven");await health({lastPollOk:true,claimed:true,lastEventId:event.event_id,lastOutcome:result?.providerConfirmed===true?"provider_confirmed":result?.blocked===true?"blocked":"retry"})}
 catch(error){await complete(event,"retry",{},error instanceof Error?error.message:String(error)).catch(()=>{});throw error}}
let failures=0;console.log(`Georgie governed portal worker ${VERSION} online`);while(true){try{await cycle();failures=0;await delay(POLL_MS)}catch(error){failures++;console.error(new Date().toISOString(),"Portal worker cycle failed:",error instanceof Error?error.message:error);await delay(Math.min(30000,POLL_MS*2**Math.min(failures,4)))}}
