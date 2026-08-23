import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const manifest=JSON.parse(fs.readFileSync(new URL("../mac-agent/neo-preload-extension/manifest.json",import.meta.url),"utf8"));
const source=fs.readFileSync(new URL("../mac-agent/neo-preload-extension/preload.js",import.meta.url),"utf8");

test("NEO preload is narrowly scoped and runs in the page main world before navigation",()=>{
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.content_scripts[0].matches,["https://app.neo.space/*"]);
  assert.equal(manifest.content_scripts[0].run_at,"document_start");
  assert.equal(manifest.content_scripts[0].world,"MAIN");
  assert.equal(manifest.permissions,undefined);
  assert.equal(manifest.host_permissions,undefined);
  assert.match(source,/preNavigation/);
  assert.match(source,/performance\.timeOrigin/);
});

test("NEO preload captures only bounded GET response state and no credentials or request payloads",()=>{
  assert.match(source,/\["GET", "HEAD"\]/);
  assert.match(source,/requestBodiesCaptured: false/);
  assert.match(source,/webSocketPayloadsCaptured: false/);
  assert.match(source,/persistedMessageContent: false/);
  assert.doesNotMatch(source,/document\.cookie|localStorage|sessionStorage|chrome\.storage|request\.headers|response\.headers\.entries/);
  assert.match(source,/state\.mailboxMutation = true/);
  assert.match(source,/api\.flockmail\.com/);
  assert.match(source,/bll\.flockmail\.com/);
  assert.match(source,/authorization/);
});

test("NEO adapter refuses certification without a completed pre-navigation capture",()=>{
  const script=fs.readFileSync(new URL("../mac-agent/neo-mail-reader.js",import.meta.url),"utf8");
  assert.match(script,/NEO_PRE_NAVIGATION_HOOK_NOT_PROVEN/);
  assert.match(script,/missing_pre_navigation_hook/);
  assert.match(script,/neo-preload-api:/);
  assert.match(script,/connection\.apiProbe\?\.status !== "completed"/);
});
