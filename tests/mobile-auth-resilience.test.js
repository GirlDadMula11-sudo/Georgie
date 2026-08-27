import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("native authentication has a bounded provider-verified fallback without persisting raw tokens",async()=>{
  const source=await readFile(new URL("../src/mobile-auth.js",import.meta.url),"utf8");
  assert.match(source,/providerIndependentVerifiedDeviceFallback:true/);
  assert.match(source,/cachedDevice\(tokenHash\)/);
  assert.match(source,/providerUnavailableUntil/);
  assert.match(source,/AbortSignal\.timeout\(4000\)/);
  assert.match(source,/rawTokensPersisted:false/);
  assert.match(source,/verifiedDevices\.set\(tokenHash,\{tokenHash,device,verifiedAt:now\}\)/);
  assert.match(source,/await persistCache\(\)/);
  assert.match(source,/cachePersistTail=Promise\.resolve\(\)/);
  assert.match(source,/crypto\.randomUUID\(\)/);
  assert.match(source,/cachePersistTail\.catch\(\(\)=>\{\}\)\.then/);
  assert.doesNotMatch(source,/JSON\.stringify\([^\n]*raw/);
});
