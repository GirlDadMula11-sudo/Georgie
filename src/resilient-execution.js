import crypto from "node:crypto";

const TRANSIENT_PATTERNS=[/timeout/i,/timed out/i,/temporar/i,/connection reset/i,/econnreset/i,/econnrefused/i,/rate.?limit/i,/\b429\b/,/\b502\b/,/\b503\b/,/\b504\b/,/network/i,/fetch failed/i,/load failed/i];
const AUTH_PATTERNS=[/unauthori[sz]ed/i,/forbidden/i,/permission/i,/credential/i,/api key/i,/\b401\b/,/\b403\b/];
const INPUT_PATTERNS=[/invalid/i,/expected pattern/i,/required/i,/malformed/i,/schema/i,/validation/i,/\b400\b/];

export function classifyExecutionError(error=""){
  const message=String(error||"Unknown execution failure");
  if(AUTH_PATTERNS.some(pattern=>pattern.test(message)))return{category:"authorization",retryable:false,message};
  if(INPUT_PATTERNS.some(pattern=>pattern.test(message)))return{category:"invalid_request",retryable:false,message};
  if(TRANSIENT_PATTERNS.some(pattern=>pattern.test(message)))return{category:"transient_provider",retryable:true,message};
  return{category:"runtime_failure",retryable:false,message};
}

export async function executeWithRecovery({action,userId,policy,risk="read",execute,timeoutMs=12000,fallback=null,onProgress,onLateResult}={}){
  const recoveryId=crypto.randomUUID(),attempts=[];
  const run=async(descriptor,attempt)=>{
    onProgress?.({type:"status",stage:attempt>1?"retrying":"tool_running",message:`${descriptor.tool}: ${attempt>1?"safe retry":"primary attempt"}.`,tool:descriptor.tool,recoveryId,attempt});
    const operation=execute({name:descriptor.tool,args:descriptor.args||{},userId,policy});operation.catch(()=>{});
    const raced=await Promise.race([operation,new Promise(resolve=>setTimeout(()=>resolve({ok:false,tool:descriptor.tool,timedOut:true,error:`${descriptor.tool} exceeded its ${timeoutMs}ms foreground deadline`}),timeoutMs))]);
    if(raced?.timedOut){operation.then(result=>onLateResult?.({recoveryId,action:descriptor,result})).catch(error=>onLateResult?.({recoveryId,action:descriptor,result:{ok:false,tool:descriptor.tool,error:error instanceof Error?error.message:String(error)}}));}
    attempts.push({tool:descriptor.tool,attempt,ok:raced?.ok===true,timedOut:Boolean(raced?.timedOut),error:raced?.error||null});
    return raced;
  };
  let result=await run(action,1);
  if(result?.ok===false&&!result?.timedOut){const classified=classifyExecutionError(result.error);if(risk==="read"&&classified.retryable)result=await run(action,2);}
  if(result?.ok===false&&!result?.timedOut&&fallback&&risk==="read"){
    const classified=classifyExecutionError(result.error);
    if(classified.category!=="authorization"&&classified.category!=="invalid_request"){
      onProgress?.({type:"status",stage:"fallback",message:`${action.tool} failed; switching to authorized fallback ${fallback.tool}.`,tool:fallback.tool,recoveryId});
      result=await run(fallback,attempts.length+1);result={...result,fallbackFor:action.tool};
    }
  }
  if(result?.ok===false){const classified=classifyExecutionError(result.error);return{...result,recoveryId,durable:Boolean(result.timedOut),errorCategory:classified.category,retryable:classified.retryable,attempts,exactBlocker:classified.message,partialVerifiedResults:[]};}
  return{...result,recoveryId,attempts,recovered:attempts.length>1||Boolean(result.fallbackFor)};
}

export const AUTHORIZED_READ_FALLBACKS={
  "system.supabase":{tool:"sierra.infrastructure",args:{}},
  "system.providers":{tool:"system.render",args:{}}
};
