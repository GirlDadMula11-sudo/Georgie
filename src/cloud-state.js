const CLOUD_URL = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const CLOUD_KEY = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
const ENABLED = Boolean(CLOUD_URL && CLOUD_KEY);
let lastError = null;

function headers(){return {"content-type":"application/json","apikey":CLOUD_KEY,"authorization":`Bearer ${CLOUD_KEY}`};}
async function rpc(name,body){const r=await fetch(`${CLOUD_URL}/rest/v1/rpc/${name}`,{method:"POST",headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error(`${name} failed (${r.status})`);return r.json();}
export function cloudStateStatus(){return {enabled:ENABLED,healthy:ENABLED?!lastError:true,lastError};}
export async function readCloudState(userId,namespace,fallback={}){if(!ENABLED)return structuredClone(fallback);try{const value=await rpc("georgie_get_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace)});lastError=null;return value&&typeof value==="object"&&!Array.isArray(value)?value:structuredClone(fallback);}catch(error){lastError=error instanceof Error?error.message:String(error);console.warn(`Cloud state read failed for ${namespace}:`,lastError);return structuredClone(fallback);}}
export async function writeCloudState(userId,namespace,state){if(!ENABLED)return false;try{await rpc("georgie_put_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace),p_state:state});lastError=null;return true;}catch(error){lastError=error instanceof Error?error.message:String(error);console.warn(`Cloud state write failed for ${namespace}:`,lastError);return false;}}
