const MAX_ACTIVE=Math.max(1,Number(process.env.GEORGIE_MODEL_MAX_CONCURRENCY||4));
const MAX_QUEUED=Math.max(MAX_ACTIVE,Number(process.env.GEORGIE_MODEL_MAX_QUEUE||24));
const QUEUE_TIMEOUT_MS=Math.max(1000,Number(process.env.GEORGIE_MODEL_QUEUE_TIMEOUT_MS||15000));
let active=0;
const queue=[];

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
export function resourceGovernorStatus(){return{active,queued:queue.length,maxActive:MAX_ACTIVE,maxQueued:MAX_QUEUED,queueTimeoutMs:QUEUE_TIMEOUT_MS,saturated:active>=MAX_ACTIVE};}
