import test from "node:test";
import assert from "node:assert/strict";
import { assessMarketSnapshot, alpacaConfigured, liveTradingReadiness } from "../src/integrations/alpaca-market-data.js";
import { marketDataCapability } from "../src/paper-trading-lab.js";

const nowMs=Date.parse("2026-08-23T14:30:00.000Z");
const freshSnapshot={quote:{bid:100,ask:100.05,timestamp:"2026-08-23T14:29:59.000Z"},trade:{last:100.03,timestamp:"2026-08-23T14:29:59.500Z"},bar:{volume:125000,timestamp:"2026-08-23T14:29:55.000Z"}};

test("market snapshot certifies only when schema, timestamps, freshness and coherence all pass",()=>{
  const result=assessMarketSnapshot(freshSnapshot,{nowMs,maxAgeMs:15000});
  assert.equal(result.certified,true);
  assert.equal(result.fresh,true);
  assert.deepEqual(result.failures,[]);
});

test("stale quote fails closed even when prices are valid",()=>{
  const result=assessMarketSnapshot({...freshSnapshot,quote:{...freshSnapshot.quote,timestamp:"2026-08-23T14:29:30.000Z"}},{nowMs,maxAgeMs:15000});
  assert.equal(result.certified,false);
  assert.ok(result.failures.includes("stale_market_data"));
});

test("missing timestamps and incoherent prices fail certification",()=>{
  const result=assessMarketSnapshot({quote:{bid:100,ask:101,timestamp:null},trade:{last:150,timestamp:"2026-08-23T14:29:59.000Z"},bar:{volume:10,timestamp:"2026-08-23T14:29:59.000Z"}},{nowMs});
  assert.equal(result.certified,false);
  assert.ok(result.failures.includes("missing_timestamp"));
  assert.ok(result.failures.includes("incoherent_quote_trade"));
});

test("credentials alone never imply a connected live feed",()=>{
  const keys=["ALPACA_API_KEY_ID","ALPACA_API_SECRET_KEY","GEORGIE_MARKET_DATA_PROVIDER"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    process.env.ALPACA_API_KEY_ID="test-key";
    process.env.ALPACA_API_SECRET_KEY="test-secret";
    process.env.GEORGIE_MARKET_DATA_PROVIDER="alpaca";
    assert.equal(alpacaConfigured(),true);
    const capability=marketDataCapability();
    assert.equal(capability.configured,true);
    assert.equal(capability.liveFeedConnected,false);
  }finally{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test("real-money readiness requires fresh certified data and one specific approved order",()=>{
  const ready=liveTradingReadiness({marketCertification:{certified:true},orderApproval:{approved:true,orderId:"ord-123"},risk:{positionSizeValid:true,killSwitch:false,dailyLossLimitBreached:false}});
  assert.equal(ready.ready,true);
  const blocked=liveTradingReadiness({marketCertification:{certified:false},orderApproval:{approved:false},risk:{positionSizeValid:false,killSwitch:true,dailyLossLimitBreached:true}});
  assert.equal(blocked.ready,false);
  assert.ok(blocked.blockers.includes("market_data_not_certified"));
  assert.ok(blocked.blockers.includes("specific_order_approval_required"));
  assert.ok(blocked.blockers.includes("kill_switch_active"));
  assert.ok(blocked.blockers.includes("daily_loss_limit_breached"));
  assert.ok(blocked.blockers.includes("position_size_not_verified"));
});
