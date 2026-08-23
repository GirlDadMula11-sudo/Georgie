import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import(`../scripts/install-domain-aware-chat-runtime.mjs?test=${Date.now()}`);

const { investmentDirectResponse } = await import(`../src/investment-intelligence.js?test=${Date.now()}`);

test("investment capability question gets an immediate useful answer",()=>{
  const result=investmentDirectResponse("Georgie, can you manage my stocks for me with a $200 budget?");
  assert.equal(result?.completed,true);
  assert.equal(result?.route?.domain,"investment");
  assert.match(result?.text||"",/\$200/);
  assert.match(result?.text||"",/research|allocation|portfolio/i);
  assert.match(result?.text||"",/approval/i);
  assert.doesNotMatch(result?.text||"",/still working|durable|terminal|business evidence/i);
});

test("day trading followup uses recent budget and answers immediately",()=>{
  const history=[{role:"user",content:"Can you manage my stocks with a $200 budget?"},{role:"assistant",content:"Yes."}];
  const result=investmentDirectResponse("What about day trading?",history);
  assert.equal(result?.completed,true);
  assert.equal(result?.route?.domain,"investment");
  assert.match(result?.text||"",/day trading/i);
  assert.match(result?.text||"",/\$200/);
  assert.match(result?.text||"",/stop|maximum daily loss|position size/i);
  assert.doesNotMatch(result?.text||"",/still working|durable|terminal|business evidence/i);
});

test("ordinary investment research still uses the deeper intelligence path",()=>{
  assert.equal(investmentDirectResponse("Analyze Nvidia valuation and current earnings risk"),null);
});

test("mobile stream status contains no internal durability jargon",()=>{
  const source=fs.readFileSync(new URL("../src/mobile-router.js",import.meta.url),"utf8");
  assert.match(source,/message:\"Got it\.\"/);
  assert.match(source,/message:\"Still working on this\.\"/);
  assert.doesNotMatch(source,/durable and reconnectable|work will continue even if this screen disconnects/i);
});

test("ordinary chat does not expose the execution panel or Sierra-only receipt copy",()=>{
  const source=fs.readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(source,/panel\.hidden=true/);
  assert.match(source,/if\(operational\)panel\.hidden=false/);
  assert.doesNotMatch(source,/completion awaits terminal business evidence|durable connection active|long-running tool remains durable/i);
});

test("investment direct response executes before heavyweight turn orchestration",()=>{
  const source=fs.readFileSync(new URL("../src/v2-turn-engine.js",import.meta.url),"utf8");
  const quick=source.indexOf("const quickInvestment=investmentDirectResponse(input,history)");
  const envelope=source.indexOf("prepareUnifiedOperatingTurn({userId,sessionId,input})");
  assert.ok(quick>=0);
  assert.ok(envelope>=0);
  assert.ok(quick<envelope);
});
