export const RELIABILITY_BASELINE = Object.freeze({
  requiredSamples: 20,
  maxLatencyMs: 15000,
  requiredCases: [
    "ordinary_chat",
    "followup_context",
    "investment",
    "communications",
    "sierra_read",
    "planner_failure_recovery",
    "provider_timeout_recovery",
    "mixed_domain",
    "mobile_reconnect",
    "direct_answer"
  ]
});

export function assertReliabilityBaseline(result={}){
  const certification=result?.certification||{};
  const observations=Array.isArray(result?.observations)?result.observations:[];
  const failures=[];
  if(certification.certified!==true)failures.push("certification_not_green");
  if(Number(certification.sampleSize||observations.length)<RELIABILITY_BASELINE.requiredSamples)failures.push("insufficient_samples");
  if(Array.isArray(certification.failures)&&certification.failures.length)failures.push("certification_failures_present");
  for(const required of RELIABILITY_BASELINE.requiredCases){
    if(!observations.some(row=>row?.case===required&&row?.completed===true&&row?.terminalState==="verified"&&row?.usefulResponse!==false&&Number(row?.latencyMs||0)<=RELIABILITY_BASELINE.maxLatencyMs))failures.push(`missing_or_failed_case:${required}`);
  }
  if(observations.some(row=>row?.plannerLimbo===true))failures.push("planner_limbo");
  if(observations.some(row=>row?.manualResumeRequired===true))failures.push("manual_resume_required");
  if(observations.some(row=>row?.staleClientState===true))failures.push("stale_client_state");
  if(observations.some(row=>Number(row?.latencyMs||0)>RELIABILITY_BASELINE.maxLatencyMs))failures.push("latency_regression");
  if(failures.length){
    const error=new Error(`Reliability baseline regression: ${[...new Set(failures)].join(", ")}`);
    error.code="RELIABILITY_BASELINE_REGRESSION";
    error.failures=[...new Set(failures)];
    throw error;
  }
  return {ok:true,baseline:RELIABILITY_BASELINE,sampleSize:observations.length};
}
