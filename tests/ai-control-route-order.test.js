import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const repair=fs.readFileSync(new URL("../scripts/repair-server-tail.mjs",import.meta.url),"utf8");

for(const scriptName of ["prestart","dev","check"]){
  test(`${scriptName} installs AI-control routes after server-tail normalization`,()=>{
    const script=String(pkg.scripts?.[scriptName]||"");
    const repairIndex=script.indexOf("scripts/repair-server-tail.mjs");
    const relayIndex=script.indexOf("scripts/install-github-receipt-relay.mjs");
    assert.notEqual(repairIndex,-1,`${scriptName} must run server-tail normalization`);
    assert.notEqual(relayIndex,-1,`${scriptName} must install the receipt relay`);
    assert.ok(repairIndex<relayIndex,`${scriptName} must install receipt/inbound routes after tail normalization so later source slicing cannot remove them`);
  });
}

test("server-tail v2 activation fences every registered AI-control mount",()=>{
  assert.match(repair,/app\.use\(\"\/api\/ai-control\/receipt-relay\"/);
  assert.match(repair,/app\.use\(\"\/api\/ai-control\/inbound\"/);
  assert.match(repair,/app\.use\(\"\/api\/connector\"/);
  assert.match(repair,/Math\.min\(\.\.\.routeIndexes\)/);
  assert.match(repair,/preserving registered AI-control routes/);
});
