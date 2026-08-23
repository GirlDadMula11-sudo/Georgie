const DEFAULT_REQUIRED=20;
const DEFAULT_MAX_LATENCY_MS=15000;

export function certifyReliability(samples=[],options={}){
  const required=Math.max(5,Number(options.required||DEFAULT_REQUIRED));
  const maxLatencyMs=Math.max(1000,Number(options.maxLatencyMs||DEFAULT_MAX_LATENCY_MS));
  const rows=Array.isArray(samples)?samples:[];
  const failures=[];
  for(const [index,row] of rows.entries()){
    if(!row||row.completed!==true)failures.push({index,reason:"not_completed"});
    if(row?.terminalState&&!["completed","verified"].includes(row.terminalState))failures.push({index,reason:`terminal_${row.terminalState}`});
    if(Number(row?.latencyMs||0)>maxLatencyMs)failures.push({index,reason:"latency"});
    if(row?.plannerLimbo===true)failures.push({index,reason:"planner_limbo"});
    if(row?.manualResumeRequired===true)failures.push({index,reason:"manual_resume"});
    if(row?.staleClientState===true)failures.push({index,reason:"stale_client_state"});
    if(row?.usefulResponse===false)failures.push({index,reason:"not_useful"});
  }
  const enough=rows.length>=required;
  const certified=enough&&failures.length===0;
  return {certified,status:certified?"certified":enough?"failed":"insufficient_evidence",sampleSize:rows.length,required,maxLatencyMs,failures,blocksMarketDataActivation:!certified,blocksContinuousPaperTrading:!certified};
}

export function reliabilityCertificationPlan(){
  return {version:1,requiredConsecutivePasses:20,classes:["ordinary_chat","followup_context","investment","sierra_read","communications","governed_tool","planner_failure_recovery","provider_timeout_recovery","mixed_domain","mobile_reconnect"],requirements:["useful terminal response","no unexplained still-working state","no planner limbo","no stale client state","no manual resume","no false completion","bounded latency"],promotionOrder:["reliability","market_data_credentials","fresh_market_observation","continuous_paper_trading"]};
}
