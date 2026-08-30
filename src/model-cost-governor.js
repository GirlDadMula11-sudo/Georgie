import { randomUUID } from "node:crypto";

const integer=(value,fallback,min=0,max=Number.MAX_SAFE_INTEGER)=>{const parsed=Number(value);return Number.isFinite(parsed)?Math.max(min,Math.min(max,Math.floor(parsed))):fallback;};
const CLOUD_URL=()=>String(process.env.GEORGIE_SUPABASE_URL||"").replace(/\/$/,"");
const CLOUD_KEY=()=>String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY||"");
const production=()=>process.env.NODE_ENV==="production";
const headers=()=>({"content-type":"application/json",apikey:CLOUD_KEY(),authorization:`Bearer ${CLOUD_KEY()}`});

export function modelTokenLimits(env=process.env){
  const perRequest=integer(env.GEORGIE_MODEL_TOKENS_PER_REQUEST,8_000,1,2_000_000);
  const perHour=integer(env.GEORGIE_MODEL_TOKENS_PER_HOUR,30_000,perRequest,20_000_000);
  const perDay=integer(env.GEORGIE_MODEL_TOKENS_PER_DAY,100_000,perHour,100_000_000);
  return{perRequest,perHour,perDay};
}

export function estimateModelTokens({body,maxOutputTokens}={}){
  const serialized=typeof body==="string"?body:JSON.stringify(body||{});
  const inputTokens=Math.max(1,Math.ceil(serialized.length/4));
  const outputTokens=integer(maxOutputTokens,integer(process.env.GEORGIE_MODEL_MAX_OUTPUT_TOKENS,2_000,1,200_000),1,200_000);
  return{inputTokens,outputTokens,totalTokens:inputTokens+outputTokens};
}

async function rpc(name,body){
  if(!CLOUD_URL()||!CLOUD_KEY())throw new Error("DURABLE_MODEL_SPEND_LEDGER_UNAVAILABLE");
  const response=await fetch(`${CLOUD_URL()}/rest/v1/rpc/${name}`,{method:"POST",headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(8_000)});
  const text=await response.text();let value=null;try{value=text?JSON.parse(text):null;}catch{value=text;}
  if(!response.ok)throw new Error(`MODEL_SPEND_LEDGER_${name}_${response.status}:${typeof value==="string"?value:value?.message||"failed"}`);
  return Array.isArray(value)?value[0]:value;
}

export function createMemoryTokenLedger({limits=modelTokenLimits(),now=()=>Date.now()}={}){
  const rows=new Map();
  const usage=(after)=>[...rows.values()].filter(row=>row.createdAt>=after&&row.status!=="released").reduce((sum,row)=>sum+(row.actualTokens??row.reservedTokens),0);
  return{
    async reserve(input){
      const reservedTokens=integer(input.reservedTokens,0,1);
      if(reservedTokens>limits.perRequest)throw Object.assign(new Error("Georgie per-request model token ceiling would be exceeded"),{code:"model_cost_request_token_cap"});
      const hour=usage(now()-3_600_000),day=usage(now()-86_400_000);
      if(hour+reservedTokens>limits.perHour)throw Object.assign(new Error("Georgie hourly model token ceiling would be exceeded"),{code:"model_cost_hour_token_cap"});
      if(day+reservedTokens>limits.perDay)throw Object.assign(new Error("Georgie daily model token ceiling would be exceeded"),{code:"model_cost_day_token_cap"});
      const row={...input,reservationId:input.reservationId||randomUUID(),reservedTokens,createdAt:now(),status:"reserved",actualTokens:null};rows.set(row.reservationId,row);return{...row,hourReserved:hour+reservedTokens,dayReserved:day+reservedTokens};
    },
    async reconcile({reservationId,actualTokens,status="reconciled",...telemetry}){const row=rows.get(reservationId);if(!row)throw new Error("MODEL_SPEND_RESERVATION_NOT_FOUND");Object.assign(row,telemetry,{actualTokens:integer(actualTokens,row.reservedTokens,0),status});return{...row};},
    status(){return{durable:false,limits,reservations:rows.size,hourTokens:usage(now()-3_600_000),dayTokens:usage(now()-86_400_000)};},
    rows
  };
}

const memoryLedger=createMemoryTokenLedger();
function memoryAllowed(){return !production()&&process.env.GEORGIE_MODEL_LEDGER_ALLOW_MEMORY!=="false";}

// Secondary compatibility circuit. Durable token reservations remain the
// authoritative production spend boundary; this circuit also limits request
// bursts and preserves the existing billing-exhaustion fail-closed behavior.
export function createModelCostGovernor({perMinute=12,perDay=200,billingCircuitMs=21_600_000,now=()=>Date.now()}={}){
  const minuteLimit=integer(perMinute,12,1,120),dailyLimit=integer(perDay,200,1,10_000),circuitMs=integer(billingCircuitMs,21_600_000,60_000,86_400_000);
  let minuteRequests=[],day=new Date(now()).toISOString().slice(0,10),dailyRequests=0,circuitUntil=0,billingFailures=0,blockedRequests=0,lastBlockReason=null;
  const refresh=()=>{const current=now(),currentDay=new Date(current).toISOString().slice(0,10);minuteRequests=minuteRequests.filter(value=>current-value<60_000);if(currentDay!==day){day=currentDay;dailyRequests=0;}if(circuitUntil&&current>=circuitUntil){circuitUntil=0;lastBlockReason=null;}return current;};
  const block=(reason)=>{blockedRequests+=1;lastBlockReason=reason;const error=new Error(`Georgie model request blocked: ${reason}`);error.code=`model_cost_${reason}`;throw error;};
  return{
    acquire(){const current=refresh();if(circuitUntil>current)block("billing_circuit");if(dailyRequests>=dailyLimit)block("daily_cap");if(minuteRequests.length>=minuteLimit)block("minute_cap");minuteRequests.push(current);dailyRequests+=1;return{admitted:true,dailyRequestNumber:dailyRequests,minuteRequestNumber:minuteRequests.length};},
    recordFailure({status=0,message=""}={}){const billing=Number(status)===402||(Number(status)===429&&/\b(?:no credits? remaining|insufficient[_ ]quota|billing|quota)\b/i.test(String(message)));if(billing){billingFailures+=1;circuitUntil=Math.max(circuitUntil,now()+circuitMs);lastBlockReason="billing_circuit";}return{billing,circuitOpen:circuitUntil>now()};},
    status(){const current=refresh();return{perMinuteLimit:minuteLimit,perDayLimit:dailyLimit,minuteRequests:minuteRequests.length,dailyRequests,billingCircuitOpen:circuitUntil>current,billingFailures,blockedRequests,lastBlockReason};}
  };
}

export async function reserveModelTokens({model,tier="unknown",objectiveId=null,escalationReason=null,body,maxOutputTokens,idempotencyKey=null}={}){
  const estimate=estimateModelTokens({body,maxOutputTokens}),limits=modelTokenLimits(),reservationId=randomUUID();
  const request={reservationId,objectiveId,model:String(model||"unknown"),tier:String(tier),escalationReason:String(escalationReason||"unspecified"),reservedTokens:estimate.totalTokens,estimatedInputTokens:estimate.inputTokens,estimatedOutputTokens:estimate.outputTokens,idempotencyKey:idempotencyKey||reservationId,limits};
  if(!CLOUD_URL()||!CLOUD_KEY()){
    if(memoryAllowed())return memoryLedger.reserve(request);
    throw Object.assign(new Error("Durable model spend ledger is required before production inference"),{code:"model_cost_durable_ledger_required"});
  }
  const value=await rpc("georgie_model_spend_reserve",{p_reservation_id:reservationId,p_objective_id:objectiveId,p_model:request.model,p_tier:request.tier,p_escalation_reason:request.escalationReason,p_reserved_tokens:request.reservedTokens,p_estimated_input_tokens:request.estimatedInputTokens,p_estimated_output_tokens:request.estimatedOutputTokens,p_idempotency_key:request.idempotencyKey,p_request_limit:limits.perRequest,p_hour_limit:limits.perHour,p_day_limit:limits.perDay});
  if(value?.admitted===false)throw Object.assign(new Error(value.reason||"Model token ceiling would be exceeded"),{code:`model_cost_${value.reason||"token_cap"}`});
  return{...request,...value,durable:true};
}

export async function reconcileModelTokens({reservationId,usage={},latencyMs=0,qualityResult="unknown",outcome="completed",errorCode=null}={}){
  const actualTokens=integer(usage.total_tokens??usage.totalTokens,integer(usage.input_tokens??usage.inputTokens,0)+integer(usage.output_tokens??usage.outputTokens,0),0);
  const input={reservationId,actualTokens,inputTokens:integer(usage.input_tokens??usage.inputTokens,0),outputTokens:integer(usage.output_tokens??usage.outputTokens,0),latencyMs:integer(latencyMs,0),qualityResult:String(qualityResult),outcome:String(outcome),errorCode:errorCode?String(errorCode).slice(0,120):null};
  if(!CLOUD_URL()||!CLOUD_KEY()){
    if(memoryAllowed())return memoryLedger.reconcile(input);
    return null;
  }
  return rpc("georgie_model_spend_reconcile",{p_reservation_id:reservationId,p_actual_tokens:input.actualTokens,p_input_tokens:input.inputTokens,p_output_tokens:input.outputTokens,p_latency_ms:input.latencyMs,p_quality_result:input.qualityResult,p_outcome:input.outcome,p_error_code:input.errorCode});
}

const requestCircuit=createModelCostGovernor({perMinute:process.env.GEORGIE_MODEL_REQUESTS_PER_MINUTE||12,perDay:process.env.GEORGIE_MODEL_REQUESTS_PER_DAY||200,billingCircuitMs:process.env.GEORGIE_MODEL_BILLING_CIRCUIT_MS||21_600_000});
export const recordModelProviderFailure=input=>requestCircuit.recordFailure(input);
export async function acquireModelSpendPermit(input={}){requestCircuit.acquire();return reserveModelTokens(input);}
export const modelCostGovernorStatus=()=>({...memoryLedger.status(),...requestCircuit.status(),configuredDurable:Boolean(CLOUD_URL()&&CLOUD_KEY()),productionFailClosed:production(),limits:modelTokenLimits()});
