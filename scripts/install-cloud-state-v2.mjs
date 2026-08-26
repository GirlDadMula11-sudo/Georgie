import fs from "node:fs";

const path = "src/cloud-state.js";
let source = fs.readFileSync(path, "utf8");
let changed = false;

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`cloud-state v2 installer missing ${label} anchor`);
  source = source.replace(from, to);
  changed = true;
}

replaceRequired(
  'function stateKey(userId,namespace){return `${String(userId||"primary")}\\u0000${String(namespace)}`;}',
  'function stateKey(userId,namespace){return `${String(userId||"primary")}\\u0000${String(namespace)}`;}\nfunction normalizedCloudNamespace(namespace){return namespace==="governed_external_connector"||namespace==="durable_turn_runtime_v1"||namespace==="events";}',
  "normalized namespace selector"
);

replaceRequired(
  'await rpc("georgie_put_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace),p_state:state},{attempts});',
  'await rpc(normalizedCloudNamespace(namespace)?"georgie_put_operational_state_v2":"georgie_put_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace),p_state:state},{attempts});',
  "normalized write rpc"
);

replaceRequired(
  'await rpc("georgie_get_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace)})',
  'await rpc(normalizedCloudNamespace(namespace)?"georgie_get_operational_state_v2":"georgie_get_operational_state",{p_user_id:String(userId||"primary"),p_namespace:String(namespace)})',
  "normalized read rpc"
);

if (changed) fs.writeFileSync(path, source);
if (!source.includes('normalizedCloudNamespace') || !source.includes('georgie_put_operational_state_v2') || !source.includes('georgie_get_operational_state_v2')) {
  throw new Error("cloud-state v2 installation did not converge");
}
console.log(`[Georgie] normalized cloud-state v2 installed: changed=${changed}`);
