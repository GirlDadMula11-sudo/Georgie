const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value,min,max)=>Math.min(max,Math.max(min,value));

export function dayTradingCapabilityContract(){
  return {
    schema:"georgie.day-trading.v2",
    mode:"decision_support_and_paper_trading",
    autonomousLiveTrading:false,
    transactionSpecificApprovalRequired:true,
    marketData:{liveOrTimestampedRequired:true,staleDataFailsClosed:true,quoteFields:["bid","ask","last","volume","timestamp"]},
    regimes:["trend","range","breakout","reversal","high_volatility","low_liquidity","event_risk"],
    setupFamilies:["opening_range_breakout","vwap_reclaim_reject","trend_pullback","range_reversion","relative_strength_weakness","catalyst_momentum"],
    riskControls:["risk_per_trade","max_daily_loss","max_open_risk","max_consecutive_losses","spread_guard","liquidity_guard","event_guard","cooldown","kill_switch"],
    learning:["paper_trade_ledger","setup_attribution","expectancy","profit_factor","max_drawdown","MAE_MFE","slippage","calibration","regime_conditioned_performance"],
  };
}

export function classifyIntradayRegime({price,vwap,atrPct,relativeVolume,spreadPct,trendStrength,eventRisk=false}={}){
  const p=finite(price),v=finite(vwap),atr=finite(atrPct),rv=finite(relativeVolume),spread=finite(spreadPct),trend=finite(trendStrength);
  if([p,v,atr,rv,spread,trend].some(x=>x===null)) return {regime:"unknown",confidence:0,blocker:"fresh intraday regime inputs required"};
  if(eventRisk) return {regime:"event_risk",confidence:.9};
  if(spread>.01 || rv<.35) return {regime:"low_liquidity",confidence:.9};
  if(atr>.06) return {regime:"high_volatility",confidence:.85};
  if(trend>=.7 && Math.abs(p-v)/Math.max(v,.0001)>.003) return {regime:"trend",confidence:clamp(.65+trend*.3,0,1)};
  if(trend<.35 && Math.abs(p-v)/Math.max(v,.0001)<.004) return {regime:"range",confidence:.75};
  return {regime:"mixed",confidence:.55};
}

export function sizeIntradayPosition({equity,riskFraction=.005,entry,stop,maxNotionalFraction=.25}={}){
  const eq=finite(equity),e=finite(entry),s=finite(stop),rf=finite(riskFraction),nf=finite(maxNotionalFraction);
  if([eq,e,s,rf,nf].some(x=>x===null)||eq<=0||e<=0||e===s) return {ok:false,reason:"valid equity, entry, stop and risk limits required"};
  const riskBudget=eq*clamp(rf,0,.02),riskPerShare=Math.abs(e-s);
  const byRisk=Math.floor(riskBudget/riskPerShare),byNotional=Math.floor((eq*clamp(nf,0,1))/e),shares=Math.max(0,Math.min(byRisk,byNotional));
  return {ok:shares>0,shares,riskBudget:Number(riskBudget.toFixed(2)),plannedLoss:Number((shares*riskPerShare).toFixed(2)),notional:Number((shares*e).toFixed(2))};
}

export function evaluateDayTrade(candidate={},policy={}){
  const required=["symbol","side","entry","stop","target","bid","ask","last","volume","timestamp"];
  const missing=required.filter(k=>candidate[k]===undefined||candidate[k]===null||candidate[k]==="");
  if(missing.length) return {decision:"blocked",score:0,reasons:[`missing ${missing.join(", ")}`]};
  const bid=finite(candidate.bid),ask=finite(candidate.ask),entry=finite(candidate.entry),stop=finite(candidate.stop),target=finite(candidate.target),volume=finite(candidate.volume);
  if([bid,ask,entry,stop,target,volume].some(x=>x===null)) return {decision:"blocked",score:0,reasons:["invalid numeric market data"]};
  const spreadPct=(ask-bid)/Math.max((ask+bid)/2,.0001),risk=Math.abs(entry-stop),reward=Math.abs(target-entry),rr=reward/Math.max(risk,.0001);
  const maxSpread=finite(policy.maxSpreadPct)??.005,minVolume=finite(policy.minVolume)??100000,minRR=finite(policy.minRewardRisk)??1.5;
  const reasons=[]; let score=100;
  if(spreadPct>maxSpread){score-=40;reasons.push("spread too wide");}
  if(volume<minVolume){score-=30;reasons.push("insufficient liquidity");}
  if(rr<minRR){score-=35;reasons.push("reward/risk below policy");}
  if(candidate.eventRisk){score-=30;reasons.push("event risk active");}
  if(candidate.regimeFit===false){score-=25;reasons.push("setup conflicts with regime");}
  score=clamp(score,0,100);
  return {decision:score>=75?"paper_candidate":score>=55?"watch":"reject",score,spreadPct:Number(spreadPct.toFixed(5)),rewardRisk:Number(rr.toFixed(2)),reasons};
}

export function dayTradingRiskGate({dailyPnl=0,equity,openRisk=0,consecutiveLosses=0,dataAgeSeconds=0,killSwitch=false}={},policy={}){
  const eq=finite(equity); if(eq===null||eq<=0) return {allowed:false,reasons:["equity required"]};
  const reasons=[];
  const maxDailyLoss=eq*(finite(policy.maxDailyLossFraction)??.02),maxOpenRisk=eq*(finite(policy.maxOpenRiskFraction)??.015);
  if(killSwitch) reasons.push("kill switch active");
  if(finite(dailyPnl)!==null && finite(dailyPnl)<=-maxDailyLoss) reasons.push("daily loss limit reached");
  if(finite(openRisk)!==null && finite(openRisk)>=maxOpenRisk) reasons.push("open risk limit reached");
  if(Number(consecutiveLosses)>=(finite(policy.maxConsecutiveLosses)??3)) reasons.push("consecutive-loss cooldown required");
  if(Number(dataAgeSeconds)>(finite(policy.maxDataAgeSeconds)??15)) reasons.push("market data stale");
  return {allowed:reasons.length===0,reasons,maxDailyLoss:Number(maxDailyLoss.toFixed(2)),maxOpenRisk:Number(maxOpenRisk.toFixed(2))};
}

export function summarizePaperPerformance(trades=[]){
  const closed=trades.filter(t=>Number.isFinite(Number(t.pnl)));
  if(!closed.length) return {sampleSize:0,qualified:false,reason:"no closed paper trades"};
  const pnls=closed.map(t=>Number(t.pnl)),wins=pnls.filter(x=>x>0),losses=pnls.filter(x=>x<0),grossWin=wins.reduce((a,b)=>a+b,0),grossLoss=Math.abs(losses.reduce((a,b)=>a+b,0));
  let equity=0,peak=0,maxDrawdown=0; for(const pnl of pnls){equity+=pnl;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);}
  return {sampleSize:closed.length,qualified:closed.length>=30,winRate:Number((wins.length/closed.length).toFixed(3)),expectancy:Number((pnls.reduce((a,b)=>a+b,0)/closed.length).toFixed(2)),profitFactor:grossLoss?Number((grossWin/grossLoss).toFixed(2)):null,maxDrawdown:Number(maxDrawdown.toFixed(2))};
}
