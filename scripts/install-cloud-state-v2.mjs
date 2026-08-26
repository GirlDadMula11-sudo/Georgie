import fs from "node:fs";

const path = "src/cloud-state.js";
let source = fs.readFileSync(path, "utf8");
let changed = false;

if (
  source.includes('georgie_patch_operational_state_v2') &&
  source.includes('buildNormalizedPatch') &&
  source.includes('priorState:existing?.state')
) {
  console.log('[Georgie] normalized cloud-state v2 delta path already installed: changed=false');
  process.exit(0);
}

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`cloud-state v2 installer missing ${label} anchor`);
  source = source.replace(from, to);
  changed = true;
}

replaceRequired(
  'function stateKey(userId,namespace){return `${String(userId||"primary")}\\u0000${String(namespace)}`;}',
  'function stateKey(userId,namespace){return `${String(userId||"primary")}\\u0000${String(namespace)}`;}\nfunction normalizedCloudNamespace(namespace){return namespace==="governed_external_connector"||namespace==="durable_turn_runtime_v1"||namespace==="events";}\nfunction normalizedArrayKeys(namespace){if(namespace==="governed_external_connector")return ["receipts","events","commands"];if(namespace==="durable_turn_runtime_v1")return ["jobs"];if(namespace==="events")return ["events"];return [];}\nfunction normalizedItemId(namespace,key,item,position){const value=item&&typeof item==="object"&&!Array.isArray(item)?item:{};return String(value.receiptId||value.id||value.requestId||value.commandId||value.sessionId||crypto.createHash("md5").update(`${namespace}:${key}:${position}:${JSON.stringify(item)}`).digest("hex"));}\nfunction normalizedItemHash(item){return crypto.createHash("md5").update(JSON.stringify(item)).digest("hex");}\nfunction buildNormalizedPatch(namespace,priorState,nextState){const keys=normalizedArrayKeys(namespace),head={...(nextState&&typeof nextState==="object"&&!Array.isArray(nextState)?nextState:{})},upserts=[],deletes=[];for(const key of keys){delete head[key];const prior=Array.isArray(priorState?.[key])?priorState[key]:[],next=Array.isArray(nextState?.[key])?nextState[key]:[],priorMap=new Map();for(let i=0;i<prior.length;i+=1){const item=prior[i],id=normalizedItemId(namespace,key,item,i);priorMap.set(id,{item,position:i,hash:normalizedItemHash(item)});}const nextIds=new Set();for(let i=0;i<next.length;i+=1){const item=next[i],id=normalizedItemId(namespace,key,item,i),hash=normalizedItemHash(item),old=priorMap.get(id);nextIds.add(id);if(!old||old.hash!==hash||old.position!==i)upserts.push({state_key:key,item_id:id,position:i,item,item_hash:hash});}for(const [id] of priorMap)if(!nextIds.has(id))deletes.push({state_key:key,item_id:id});}return {head,upserts,deletes};}',
  "normalized delta helpers"
);

replaceRequired(
  'async function putCloud(userId,namespace,state,{attempts=FOREGROUND_ATTEMPTS}={}){await rpc("georgie_put_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace),p_state:state},{attempts});lastError=null;lastSuccessAt=new Date().toISOString();const mirror=await readMirror(userId,namespace);if(mirror?.dirty)pendingWrites=Math.max(0,pendingWrites-1);await writeMirror(userId,namespace,state,false);}',
  'async function putCloud(userId,namespace,state,{attempts=FOREGROUND_ATTEMPTS,priorState=null}={}){if(normalizedCloudNamespace(namespace)&&priorState&&typeof priorState==="object"&&!Array.isArray(priorState)){const patch=buildNormalizedPatch(namespace,priorState,state);await rpc("georgie_patch_operational_state_v2",{p_user_id:String(userId||"primary"),p_namespace:String(namespace),p_head:patch.head,p_upserts:patch.upserts,p_deletes:patch.deletes},{attempts});}else{await rpc(normalizedCloudNamespace(namespace)?"georgie_put_operational_state_v2":"georgie_put_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace),p_state:state},{attempts});}lastError=null;lastSuccessAt=new Date().toISOString();const mirror=await readMirror(userId,namespace);if(mirror?.dirty)pendingWrites=Math.max(0,pendingWrites-1);await writeMirror(userId,namespace,state,false);}',
  "normalized delta write rpc"
);

replaceRequired(
  'await rpc("georgie_get_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace)})',
  'await rpc(normalizedCloudNamespace(namespace)?"georgie_get_operational_state_v2":"georgie_get_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace)})',
  "normalized read rpc"
);

replaceRequired(
  'try{await putCloud(userId,namespace,state);cacheState(key,state);return true;}',
  'try{await putCloud(userId,namespace,state,{priorState:existing?.state});cacheState(key,state);return true;}',
  "delta prior-state handoff"
);

if (changed) fs.writeFileSync(path, source);
if (!source.includes('normalizedCloudNamespace') || !source.includes('georgie_put_operational_state_v2') || !source.includes('georgie_get_operational_state_v2') || !source.includes('georgie_patch_operational_state_v2') || !source.includes('buildNormalizedPatch') || !source.includes('priorState:existing?.state')) {
  throw new Error("cloud-state v2 delta installation did not converge");
}
console.log(`[Georgie] normalized cloud-state v2 delta path installed: changed=${changed}`);
