import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { alpacaConfigured, certifyAlpacaConnection, latestStockSnapshot } from "./integrations/alpaca-market-data.js";

const NS="paper_trading_lab";
const now=()=>new Date().toISOString();

export function marketDataCapability(){
  const provider=String(process.env.GEORGIE_MARKET_DATA_PROVIDER||"alpaca").trim().toLowerCase();
  const configured=provider==="alpaca"&&alpacaConfigured();
  return {provider,configured,liveFeedConnected:false,mode:"paper_only",note:configured?"Alpaca credentials are configured; Georgie must independently verify live bid/ask/last/volume timestamps and per-observation freshness before intraday scanning is certified.":"Alpaca adapter is installed but credentials are not yet configured; Georgie must independently verify live bid/ask/last/volume timestamps before live scanning is certified."};
}

export async function certifyMarketData(input={}){
  const provider=String(process.env.GEORGIE_MARKET_DATA_PROVIDER||"alpaca").trim().toLowerCase();
  if(provider!=="alpaca")return{provider,configured:false,certified:false,reason:"unsupported_provider"};
  return certifyAlpacaConnection({symbol:input.symbol||"AAPL"});
}

export async function livePaperSnapshot(symbol,options={}){
  const capability=marketDataCapability();
  if(capability.provider!=="alpaca")throw new Error("unsupported market data provider");
  if(!capability.configured)throw new Error("Alpaca market data credentials are not configured");
  const snapshot=await latestStockSnapshot(symbol,options);
  if(!snapshot.schemaValid)throw new Error("market data schema validation failed");
  if(options.requireFresh!==false&&!snapshot.fresh)throw new Error("market data is stale for intraday decisioning");
  return snapshot;
}

async function state(userId){return readCloudState(String(userId),NS,{candidates:[],trades:[],updatedAt:null});}

export async function recordPaperCandidate(userId,input={}){
  const s=await state(userId);
  const candidate={id:crypto.randomUUID(),symbol:String(input.symbol||"").toUpperCase(),setup:String(input.setup||"unknown"),regime:String(input.regime||"unknown"),observedAt:input.observedAt||now(),entry:Number(input.entry),stop:Number(input.stop),target:Number(input.target),spreadBps:Number(input.spreadBps||0),estimatedSlippageBps:Number(input.estimatedSlippageBps||0),evidence:input.evidence||{},status:"candidate"};
  const candidates=[...(s.candidates||[]),candidate].slice(-5000);
  await writeCloudState(String(userId),NS,{...s,candidates,updatedAt:now()});
  return candidate;
}

export async function recordCandidateFromLiveMarket(userId,input={}){
  const snapshot=await livePaperSnapshot(input.symbol,{requireFresh:true});
  return recordPaperCandidate(userId,{...input,observedAt:snapshot.observedAt,spreadBps:snapshot.spreadBps,evidence:{...(input.evidence||{}),marketData:snapshot}});
}

export async function settlePaperTrade(userId,input={}){
  const s=await state(userId);
  const candidate=(s.candidates||[]).find(item=>item.id===input.candidateId);
  if(!candidate)throw new Error("paper candidate not found");
  const exit=Number(input.exit);
  const side=input.side==="short"?"short":"long";
  const grossR=side==="long"?(exit-candidate.entry)/Math.max(1e-9,candidate.entry-candidate.stop):(candidate.entry-exit)/Math.max(1e-9,candidate.stop-candidate.entry);
  const costR=Math.abs((candidate.spreadBps+candidate.estimatedSlippageBps)/10000*candidate.entry/Math.max(1e-9,Math.abs(candidate.entry-candidate.stop)));
  const trade={id:crypto.randomUUID(),candidateId:candidate.id,symbol:candidate.symbol,setup:candidate.setup,regime:candidate.regime,side,entry:candidate.entry,exit,stop:candidate.stop,target:candidate.target,grossR,netR:grossR-costR,openedAt:candidate.observedAt,closedAt:input.closedAt||now(),maeR:Number(input.maeR||0),mfeR:Number(input.mfeR||0),notes:String(input.notes||"")};
  const trades=[...(s.trades||[]),trade].slice(-5000);
  await writeCloudState(String(userId),NS,{...s,trades,updatedAt:now()});
  return trade;
}

export async function paperLabSummary(userId){
  const s=await state(userId);const trades=Array.isArray(s.trades)?s.trades:[];const n=trades.length;
  const wins=trades.filter(t=>t.netR>0);const losses=trades.filter(t=>t.netR<=0);const grossWin=wins.reduce((a,t)=>a+t.netR,0);const grossLoss=Math.abs(losses.reduce((a,t)=>a+t.netR,0));
  let equity=0,peak=0,maxDrawdownR=0;for(const t of trades){equity+=t.netR;peak=Math.max(peak,equity);maxDrawdownR=Math.max(maxDrawdownR,peak-equity);}
  return {sampleSize:n,winRate:n?wins.length/n:null,expectancyR:n?trades.reduce((a,t)=>a+t.netR,0)/n:null,profitFactor:grossLoss?grossWin/grossLoss:null,maxDrawdownR,edgeStatus:n<30?"insufficient_sample":"eligible_for_review",bySetup:Object.fromEntries([...new Set(trades.map(t=>t.setup))].map(setup=>{const rows=trades.filter(t=>t.setup===setup);return[setup,{n:rows.length,expectancyR:rows.reduce((a,t)=>a+t.netR,0)/rows.length}]})),marketData:marketDataCapability(),updatedAt:s.updatedAt||null};
}
