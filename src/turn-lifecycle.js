export const TURN_DEADLINE_MS=Math.max(20000,Math.min(55000,Number(process.env.GEORGIE_TURN_DEADLINE_MS||52000)));

export function terminalPartialResult({startedAt,firstResponseMs=0,reason="turn_deadline",detail=""}={}){
  const latencyMs=Math.max(0,Date.now()-Number(startedAt||Date.now()));
  const providerTimedOut=reason==="provider_timeout";
  const text=providerTimedOut
    ? "I accepted and preserved this request, but the intelligence provider timed out before I could finish the verified response. I have not treated any unfinished check or action as completed. The work is retained for recovery, so you can ask me to continue without restating the objective."
    : "I reached the bounded response deadline before every requested check finished. Any accepted tool work remains durable, but I have not treated it as completed. The work is retained for recovery, so you can ask me to continue from the available evidence.";
  return {
    text,
    responseId:null,
    webSearches:0,
    model:"bounded-terminal-recovery",
    route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"},
    remembered:0,
    memoryCount:0,
    actions:[],
    evidence:[],
    evidenceFreshness:"none",
    confidence:"partial_unverified",
    engine:"v2-bounded-terminal",
    latencyMs,
    firstResponseMs:firstResponseMs||latencyMs,
    contextReadyMs:latencyMs,
    completed:false,
    terminal:true,
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
  // The operation is intentionally not cancelled: queued tools are durable and
  // late completion may still write its evidence journal. This catch prevents a
  // detached rejection after the terminal response has been returned.
  operation.catch(()=>{});
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve(onDeadline()),timeoutMs);});
  try{return await Promise.race([operation,deadline]);}finally{clearTimeout(timer);}
}
