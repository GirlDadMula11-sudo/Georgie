import test from "node:test";
import assert from "node:assert/strict";
import {classifyIntradayRegime,dayTradingCapabilityContract,dayTradingRiskGate,evaluateDayTrade,sizeIntradayPosition,summarizePaperPerformance} from "../src/day-trading-intelligence.js";

test("day trading contract is sophisticated but never grants autonomous live trading",()=>{const c=dayTradingCapabilityContract();assert.equal(c.autonomousLiveTrading,false);assert.equal(c.transactionSpecificApprovalRequired,true);assert.ok(c.riskControls.includes("kill_switch"));assert.ok(c.learning.includes("regime_conditioned_performance"));});
test("stale data fails the risk gate closed",()=>{const r=dayTradingRiskGate({equity:200,dataAgeSeconds:30});assert.equal(r.allowed,false);assert.match(r.reasons.join(" "),/stale/);});
test("small account sizing respects both risk and notional caps",()=>{const r=sizeIntradayPosition({equity:200,riskFraction:.005,entry:10,stop:9.8,maxNotionalFraction:.25});assert.equal(r.ok,true);assert.ok(r.plannedLoss<=1);assert.ok(r.notional<=50);});
test("bad liquidity and weak reward risk reject a setup",()=>{const r=evaluateDayTrade({symbol:"TEST",side:"long",entry:10,stop:9.8,target:10.1,bid:9.9,ask:10.1,last:10,volume:5000,timestamp:new Date().toISOString()});assert.equal(r.decision,"reject");assert.ok(r.reasons.length>=2);});
test("regime classifier blocks missing evidence and recognizes trend",()=>{assert.equal(classifyIntradayRegime({}).regime,"unknown");assert.equal(classifyIntradayRegime({price:101,vwap:100,atrPct:.02,relativeVolume:1.5,spreadPct:.001,trendStrength:.8}).regime,"trend");});
test("paper ledger computes expectancy and waits for a real sample",()=>{const small=summarizePaperPerformance([{pnl:2},{pnl:-1},{pnl:3}]);assert.equal(small.qualified,false);assert.equal(small.expectancy,1.33);const sample=summarizePaperPerformance(Array.from({length:30},(_,i)=>({pnl:i%2?1:-.5})));assert.equal(sample.qualified,true);assert.ok(sample.profitFactor>1);});
