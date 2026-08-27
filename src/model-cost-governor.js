const clamp=(value,min,max,fallback)=>Math.max(min,Math.min(max,Number(value)||fallback));
const utcDay=value=>new Date(value).toISOString().slice(0,10);

export function createModelCostGovernor({perMinute=12,perDay=200,billingCircuitMs=21_600_000,now=()=>Date.now()}={}){
  const minuteLimit=clamp(perMinute,1,120,12);
  const dailyLimit=clamp(perDay,1,10_000,200);
  const circuitDurationMs=clamp(billingCircuitMs,60_000,86_400_000,21_600_000);
  let minuteRequests=[],day=utcDay(now()),dailyRequests=0,billingCircuitUntil=0,billingFailures=0,blockedRequests=0,lastBlockReason=null;
  const refresh=()=>{const current=now(),currentDay=utcDay(current);minuteRequests=minuteRequests.filter(timestamp=>current-timestamp<60_000);if(currentDay!==day){day=currentDay;dailyRequests=0;}if(billingCircuitUntil&&current>=billingCircuitUntil){billingCircuitUntil=0;lastBlockReason=null;}return current;};
  const block=(reason,retryAfterMs)=>{blockedRequests+=1;lastBlockReason=reason;const error=new Error(reason==="billing_circuit"?"Georgie model cost circuit is open because API credits are exhausted":reason==="daily_cap"?"Georgie daily model request budget is exhausted":"Georgie model request rate budget is exhausted");error.code=`model_cost_${reason}`;error.retryAfterMs=retryAfterMs;throw error;};
  return{
    acquire(){const current=refresh();if(billingCircuitUntil>current)block("billing_circuit",billingCircuitUntil-current);if(dailyRequests>=dailyLimit)block("daily_cap",new Date(`${day}T00:00:00.000Z`).getTime()+86_400_000-current);if(minuteRequests.length>=minuteLimit)block("minute_cap",60_000-(current-minuteRequests[0]));minuteRequests.push(current);dailyRequests+=1;return{admitted:true,day,dailyRequestNumber:dailyRequests,minuteRequestNumber:minuteRequests.length};},
    recordFailure({status=0,message=""}={}){const billing=Number(status)===402||(Number(status)===429&&/\b(?:no credits? remaining|insufficient[_ ]quota|billing|quota)\b/i.test(String(message)));if(billing){billingFailures+=1;billingCircuitUntil=Math.max(billingCircuitUntil,now()+circuitDurationMs);lastBlockReason="billing_circuit";}return{billing,circuitOpen:billingCircuitUntil>now()};},
    status(){const current=refresh();return{perMinuteLimit:minuteLimit,perDayLimit:dailyLimit,minuteRequests:minuteRequests.length,dailyRequests,day,billingCircuitOpen:billingCircuitUntil>current,billingCircuitUntil:billingCircuitUntil?new Date(billingCircuitUntil).toISOString():null,billingFailures,blockedRequests,lastBlockReason};}
  };
}

const governor=createModelCostGovernor({perMinute:process.env.GEORGIE_MODEL_REQUESTS_PER_MINUTE||12,perDay:process.env.GEORGIE_MODEL_REQUESTS_PER_DAY||200,billingCircuitMs:process.env.GEORGIE_MODEL_BILLING_CIRCUIT_MS||21_600_000});
export const acquireModelSpendPermit=()=>governor.acquire();
export const recordModelProviderFailure=input=>governor.recordFailure(input);
export const modelCostGovernorStatus=()=>governor.status();
