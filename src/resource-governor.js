import { performance } from "node:perf_hooks";
const MAX_ACTIVE=Math.max(1,Number(process.env.GEORGIE_MODEL_MAX_CONCURRENCY||4));
const MAX_QUEUED=Math.max(MAX_ACTIVE,Number(process.env.GEORGIE_MODEL_MAX_QUEUE||24));
const QUEUE_TIMEOUT_MS=Math.max(1000,Number(process.env.GEORGIE_MODEL_QUEUE_TIMEOUT_MS||15000));
let active=0;
const queue=[];
const SPECIALIST_MAX_UTILIZATION=Math.max(0.5,Math.min(0.99,Number(process.env.GEORGIE_SPECIALIST_MAX_EVENT_LOOP_UTILIZATION||0.85)));
const SPECIALIST_RETRY_MS=Math.max(1_000,Math.min(60_000,Number(process.env.GEORGIE_SPECIALIST_PRESSURE_RETRY_MS||5_000)));
let priorEventLoopUtilization=performance.eventLoopUtilization();
const specialistDeferrals=new Map();

function drain(){while(active<MAX_ACTIVE&&queue.length){const item=queue.shift();clearTimeout(item.timer);active+=1;item.resolve(releasePermit);}}
function releasePermit(){active=Math.max(0,active-1);drain();}

export function acquireModelPermit(){
  if(active<MAX_ACTIVE){active+=1;return Promise.resolve(releasePermit);}
  if(queue.length>=MAX_QUEUED)return Promise.reject(new Error("Georgie is at bounded reasoning capacity; retry shortly"));
  return new Promise((resolve,reject)=>{
    const item={resolve,reject,timer:null};
    item.timer=setTimeout(()=>{const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);reject(new Error("Georgie's reasoning queue exceeded its time budget"));},QUEUE_TIMEOUT_MS);
    queue.push(item);
  });
}

export async function withModelPermit(work){const release=await acquireModelPermit();try{return await work();}finally{release();}}

export function specialistExecutionPermit(lane="specialist",{utilization=null}={}){
  const snapshot=performance.eventLoopUtilization();
  const measured=utilization==null?performance.eventLoopUtilization(snapshot,priorEventLoopUtilization).utilization:Number(utilization);
  priorEventLoopUtilization=snapshot;
  const reason=active>=MAX_ACTIVE?"model_capacity":queue.length>0?"core_reasoning_queued":measured>=SPECIALIST_MAX_UTILIZATION?"event_loop_pressure":null;
  if(reason)specialistDeferrals.set(String(lane),(specialistDeferrals.get(String(lane))||0)+1);
  return{allowed:!reason,reason,retryAfterMs:reason?SPECIALIST_RETRY_MS:0,eventLoopUtilization:Number.isFinite(measured)?measured:0,activeModelRequests:active,queuedModelRequests:queue.length};
}

export function resourceGovernorStatus(){return{active,queued:queue.length,maxActive:MAX_ACTIVE,maxQueued:MAX_QUEUED,queueTimeoutMs:QUEUE_TIMEOUT_MS,saturated:active>=MAX_ACTIVE,specialistBudget:{maxEventLoopUtilization:SPECIALIST_MAX_UTILIZATION,retryMs:SPECIALIST_RETRY_MS,deferrals:Object.fromEntries(specialistDeferrals)}};}
