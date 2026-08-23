export const TURN_DEADLINE_MS=Math.max(20000,Math.min(55000,Number(process.env.GEORGIE_TURN_DEADLINE_MS||52000)));

export function terminalPartialResult({startedAt,firstResponseMs=0,reason="turn_deadline",detail=""}={}){
  const latencyMs=Math.max(0,Date.now()-Number(startedAt||Date.now()));
  const providerTimedOut=reason==="provider_timeout";
  const text=providerTimedOut
    ? "The foreground intelligence request reached its provider timeout, but this objective remains retained for automatic recovery. I have not marked unfinished work complete. You do not need to restate or manually resume the objective."
    : "The foreground response window ended before every requested check finished. Accepted work is continuing automatically and late verified results remain eligible for persistence. Nothing unfinished has been marked complete, and you do not need to ask me to continue.";
  return {
    text,
    responseId:null,
    webSearches:0,
    model:"bounded-background-continuation",
    route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"},
    remembered:0,
    memoryCount:0,
    actions:[],
    evidence:[],
    evidenceFreshness:"none",
    confidence:"partial_unverified",
    engine:"v2-bounded-background-continuation",
    latencyMs,
    firstResponseMs:firstResponseMs||latencyMs,
    contextReadyMs:latencyMs,
    completed:false,
    terminal:false,
    backgroundContinuation:true,
    terminalReason:reason,
    failureDetail:String(detail||"").slice(0,300)
  };
}

export async function withTurnDeadline(work,{timeoutMs=TURN_DEADLINE_MS,onDeadline}={}){
  let timer;
  const operation=Promise.resolve().then(work);
  // Streaming requests already have durable request identity, reconnect
  // polling, and bounded provider/tool calls. Do not convert their real late
  // result into a terminal partial merely because the HTTP turn crossed the
  // short synchronous-response budget.
  if(timeoutMs===null||timeoutMs===false)return operation;
  // The operation is intentionally not cancelled. The foreground deadline is
  // a response-window boundary only; durable or otherwise retained work must
  // be allowed to finish and persist its late verified result.
  operation.catch(()=>{});
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve(onDeadline()),timeoutMs);});
  try{return await Promise.race([operation,deadline]);}finally{clearTimeout(timer);}
}
