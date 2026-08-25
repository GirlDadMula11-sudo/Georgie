import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import(`../scripts/install-domain-aware-chat-runtime.mjs?test=${Date.now()}`);
await import(`../scripts/install-runtime-reliability.mjs?test=${Date.now()}`);
const { marketDataCapability } = await import(`../src/paper-trading-lab.js?test=${Date.now()}`);

test("planner failure degrades to normal conversation instead of task limbo",()=>{
  const source=fs.readFileSync(new URL("../src/v2-turn-engine.js",import.meta.url),"utf8");
  assert.match(source,/recordRuntimeFault\(userId/);
  assert.match(source,/planner degraded; falling back to normal response/);
  assert.doesNotMatch(source,/stage:\"planning_failed\",message:\"The governed plan could not be created/);
  assert.match(source,/return\[\];/);
});

test("production startup installs the reliability failover",()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  assert.match(pkg.scripts.prestart,/install-runtime-reliability\.mjs/);
  assert.match(pkg.scripts.check,/runtime-reliability\.js/);
  assert.match(pkg.scripts.check,/paper-trading-lab\.js/);
});

test("Smartlead backpressure installer accepts the authority-hardened successor version",()=>{
  const installer=fs.readFileSync(new URL("../scripts/install-smartlead-reply-backpressure.mjs",import.meta.url),"utf8");
  assert.match(installer,/v2\\\.5\(\?:\\\.\\d\+\)\?/);
});

test("paper trading lab cannot pretend a live feed is connected",()=>{
  const cap=marketDataCapability();
  assert.equal(cap.mode,"paper_only");
  assert.equal(cap.liveFeedConnected,false);
  assert.match(cap.note,/independently verify live bid\/ask\/last\/volume timestamps/i);
});

test("paper lab persists cost-aware performance fields",()=>{
  const source=fs.readFileSync(new URL("../src/paper-trading-lab.js",import.meta.url),"utf8");
  assert.match(source,/estimatedSlippageBps/);
  assert.match(source,/spreadBps/);
  assert.match(source,/expectancyR/);
  assert.match(source,/profitFactor/);
  assert.match(source,/maxDrawdownR/);
  assert.match(source,/insufficient_sample/);
});
