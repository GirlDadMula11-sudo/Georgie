import test from "node:test";
import assert from "node:assert/strict";
import { alpacaConfigured, certifyAlpacaConnection } from "../src/integrations/alpaca-market-data.js";
import { marketDataCapability } from "../src/paper-trading-lab.js";

test("Alpaca adapter fails closed without credentials", async()=>{
  const keys=["ALPACA_API_KEY_ID","APCA_API_KEY_ID","GEORGIE_MARKET_DATA_API_KEY","ALPACA_API_SECRET_KEY","APCA_API_SECRET_KEY","GEORGIE_MARKET_DATA_API_SECRET"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    for(const k of keys)delete process.env[k];
    process.env.GEORGIE_MARKET_DATA_PROVIDER="alpaca";
    assert.equal(alpacaConfigured(),false);
    const capability=marketDataCapability();
    assert.equal(capability.provider,"alpaca");
    assert.equal(capability.configured,false);
    assert.equal(capability.liveFeedConnected,false);
    const cert=await certifyAlpacaConnection();
    assert.equal(cert.certified,false);
    assert.equal(cert.reason,"credentials_missing");
  }finally{
    for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});

test("paper lab never claims live feed solely from provider selection",()=>{
  const oldProvider=process.env.GEORGIE_MARKET_DATA_PROVIDER;
  process.env.GEORGIE_MARKET_DATA_PROVIDER="alpaca";
  const capability=marketDataCapability();
  assert.equal(capability.liveFeedConnected,false);
  if(oldProvider===undefined)delete process.env.GEORGIE_MARKET_DATA_PROVIDER;else process.env.GEORGIE_MARKET_DATA_PROVIDER=oldProvider;
});
