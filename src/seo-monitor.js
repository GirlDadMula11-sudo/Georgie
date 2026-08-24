import { readCloudState, writeCloudState } from "./cloud-state.js";
import { scheduleObjective } from "./objective-worker.js";
import { seoIntegrationStatus } from "./integrations/seo-ops.js";

const NS="seo_monitor_schedule_v1";
const USER=()=>process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const MIN_MS=60*60*1000;
let timer=null,running=false;
const now=()=>new Date().toISOString();
const clean=(v,max=1000)=>String(v??"").trim().slice(0,max);

async function readState(userId){return readCloudState(String(userId||"primary"),NS,{enabled:false,intervalMs:24*60*60*1000,nextRunAt:null,lastScheduledAt:null,lastObjectiveKey:null,urls:[],updatedAt:null});}
async function saveState(userId,state){const next={...state,updatedAt:now()};await writeCloudState(String(userId||"primary"),NS,next);return next;}

export async function configureSeoMonitor(userId,input={}){
  const prior=await readState(userId);
  const intervalMs=Math.max(MIN_MS,Math.min(Number(input.intervalMs||prior.intervalMs||24*60*60*1000),7*24*60*60*1000));
  const urls=[...new Set((input.urls||prior.urls||[]).map(v=>clean(v,1200)).filter(Boolean))].slice(0,25);
  return saveState(userId,{...prior,enabled:input.enabled!==false,intervalMs,urls,nextRunAt:input.runNow===true?now():prior.nextRunAt||new Date(Date.now()+intervalMs).toISOString()});
}
export async function seoMonitorStatus(userId){return {...await readState(userId),providerStatus:seoIntegrationStatus(),serverSchedulerRunning:Boolean(timer)};}

export async function runSeoMonitorSchedulerCycle(userId=USER()){
  if(running)return{status:"busy"};running=true;
  try{
    const state=await readState(userId);if(!state.enabled)return{status:"disabled"};
    if(state.nextRunAt&&new Date(state.nextRunAt).getTime()>Date.now())return{status:"not_due",nextRunAt:state.nextRunAt};
    const bucket=Math.floor(Date.now()/state.intervalMs),stableKey=`seo-monitor:${bucket}`;
    const urls=(state.urls||[]).length?state.urls:[process.env.GEORGIE_WEBSITE_ROOT_URL||"https://www.sierramarketinginc.com"];
    const steps=[
      {id:"crawl",tool:"seo.crawl",args:{startUrl:urls[0],maxPages:200},policy:"read"},
      ...urls.slice(0,5).map((url,i)=>({id:`pagespeed-${i+1}`,tool:"seo.pagespeed",args:{url,strategy:"mobile"},policy:"read"})),
      {id:"funnel",tool:"seo.application_funnel",args:{days:30},policy:"read"},
      {id:"funded",tool:"seo.funded_outcomes",args:{days:365},policy:"read"}
    ];
    if(seoIntegrationStatus().googleSearchConsoleConfigured)steps.push({id:"gsc",tool:"seo.search_console",args:{rowLimit:2500},policy:"read"});
    if(seoIntegrationStatus().ga4Configured)steps.push({id:"ga4",tool:"seo.ga4",args:{limit:2500},policy:"read"});
    if(seoIntegrationStatus().syntheticConversionConfigured)steps.push({id:"synthetic",tool:"seo.synthetic_conversion",args:{},policy:"low_risk_write"});
    const scheduled=await scheduleObjective(userId,{stableKey,title:"Recurring Sierra SEO health and conversion certification",domain:"seo",priority:"normal",steps,maxAttempts:6});
    const nextRunAt=new Date(Date.now()+state.intervalMs).toISOString();
    await saveState(userId,{...state,lastScheduledAt:now(),lastObjectiveKey:stableKey,nextRunAt});
    return{status:"scheduled",stableKey,nextRunAt,scheduledStatus:scheduled.status,stepCount:steps.length};
  }finally{running=false;}
}
export function startSeoMonitorScheduler(){if(timer)return;void runSeoMonitorSchedulerCycle();timer=setInterval(()=>void runSeoMonitorSchedulerCycle().catch(e=>console.warn("SEO monitor scheduler failed:",e instanceof Error?e.message:e)),MIN_MS);timer.unref?.();}
export function stopSeoMonitorScheduler(){if(timer)clearInterval(timer);timer=null;}
