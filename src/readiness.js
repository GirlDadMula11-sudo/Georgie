export function buildReadinessSnapshot({
  openAI,
  neoMail,
  sierraWorkforce,
  macAgent,
  memoryStorage,
  operationalStorage,
  macQueue,
  runtimeMode = "kernel"
}) {
  const blockers=[];
  if(!openAI)blockers.push("OPENAI_API_KEY");
  if(!memoryStorage?.durable)blockers.push("durable_memory_not_connected");
  else if(memoryStorage.healthy===false)blockers.push("durable_memory_degraded");
  if(!operationalStorage?.enabled)blockers.push("durable_operational_state_not_connected");
  else if(operationalStorage.healthy===false||operationalStorage.degraded===true||operationalStorage.providerCircuitOpen===true)blockers.push("durable_operational_state_degraded");
  const ready=blockers.length===0;
  return{
    ready,
    activationState:ready?"core_ready":"connection_pending",
    runtimeMode:runtimeMode==="full"?"full":"kernel",
    blockers,
    optionalConnections:{neoMail:Boolean(neoMail),macAgent:Boolean(macAgent),sierraWorkforce:Boolean(sierraWorkforce)},
    connections:{
      openAI:Boolean(openAI),
      neoMail:Boolean(neoMail),
      sierraWorkforce:Boolean(sierraWorkforce),
      macAgent:Boolean(macAgent),
      liveWebResearch:process.env.GEORGIE_WEB_ENABLED!=="false",
      memoryStorage,
      operationalStorage,
      macQueue
    },
    platform:{voice:true,wakeName:true,memory:true,tasks:true,proactiveEngine:runtimeMode==="full",emailIntelligence:runtimeMode==="full",toolRouter:true,sierraWorkforce:true,macRemoteAgent:true,pwa:true,productionSecurity:true,durableOperationalState:true,nativeIOS:true,nativeDeviceAuth:true}
  };
}

export function readinessHttpStatus(snapshot){return snapshot?.ready===true?200:503;}
