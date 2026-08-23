import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("production prestart installs the domain-aware chat runtime",()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  assert.match(pkg.scripts.prestart,/install-domain-aware-chat-runtime\.mjs/);
  const installer=fs.readFileSync(new URL("../scripts/install-domain-aware-chat-runtime.mjs",import.meta.url),"utf8");
  assert.match(installer,/completion awaits terminal business evidence/);
  assert.match(installer,/panel\.hidden=true/);
  assert.match(installer,/investmentDirectResponse/);
});

test("service worker cache version is advanced beyond the stale shell",()=>{
  const sw=fs.readFileSync(new URL("../public/sw.js",import.meta.url),"utf8");
  assert.doesNotMatch(sw,/georgie-shell-v7/);
  assert.match(sw,/georgie-shell-v8/);
});
