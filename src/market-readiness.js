const requiredHomeHeaders=["content-security-policy","x-content-type-options","strict-transport-security"];

export function evaluateMarketReadiness({health,readiness,home,manifest,unauthorized,timings={}}={}){
  const blockers=[];
  if(home?.status!==200)blockers.push("home_unavailable");
  if(!String(home?.body||"").includes('id="enrollmentGate"'))blockers.push("activation_ui_missing");
  for(const header of requiredHomeHeaders)if(!home?.headers?.[header])blockers.push(`security_header_missing:${header}`);
  if(manifest?.status!==200||manifest?.body?.display!=="standalone"||manifest?.body?.start_url!=="/")blockers.push("pwa_manifest_invalid");
  if(health?.status!==200||health?.body?.ready!==true||health?.body?.ok!==true)blockers.push("health_not_ready");
  if(health?.body?.configured!==true)blockers.push("openai_not_configured");
  if(health?.body?.memoryStorage?.durable!==true||health?.body?.memoryStorage?.healthy!==true)blockers.push("durable_memory_unhealthy");
  const storage=health?.body?.operationalStorage;
  if(storage?.enabled!==true||storage?.healthy!==true||storage?.degraded===true||storage?.providerCircuitOpen===true||storage?.pendingWrites!==0||!storage?.lastSuccessAt)blockers.push("durable_operational_state_unhealthy");
  if(!Array.isArray(health?.body?.blockers)||health.body.blockers.length)blockers.push("runtime_blockers_present");
  if(readiness?.status!==200||readiness?.body?.ready!==true)blockers.push("readiness_not_ready");
  if(unauthorized?.status!==401)blockers.push("device_auth_not_fail_closed");
  for(const [route,ms] of Object.entries(timings))if(ms>5_000)blockers.push(`latency_budget_exceeded:${route}`);
  return{ready:blockers.length===0,blockers,checkedAt:new Date().toISOString(),timings};
}
