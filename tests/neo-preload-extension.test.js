import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const manifest=JSON.parse(fs.readFileSync(new URL("../mac-agent/neo-preload-extension/manifest.json",import.meta.url),"utf8"));
const source=fs.readFileSync(new URL("../mac-agent/neo-preload-extension/preload.js",import.meta.url),"utf8");
const background=fs.readFileSync(new URL("../mac-agent/neo-preload-extension/background.js",import.meta.url),"utf8");

test("NEO preload is narrowly scoped and runs in the page main world before navigation",()=>{
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.host_permissions,["https://app.neo.space/*"]);
  assert.deepEqual(manifest.permissions,["scripting"]);
  assert.equal(manifest.background.service_worker,"background.js");
  assert.match(background,/registerContentScripts/);
  assert.match(background,/runAt: "document_start"/);
  assert.match(background,/world: "MAIN"/);
  assert.match(background,/persistAcrossSessions: true/);
  assert.match(source,/preNavigation/);
  assert.match(source,/performance\.timeOrigin/);
  assert.match(source,/registered_main_world_document_start/);
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
  assert.match(source,/accountBindings/);
  assert.match(source,/sierramarketinginc\\\.com/);
  assert.match(source,/accountId/);
  assert.match(source,/authorization/);
});

test("NEO adapter refuses certification without a completed pre-navigation capture",()=>{
  const script=fs.readFileSync(new URL("../mac-agent/neo-mail-reader.js",import.meta.url),"utf8");
  assert.match(script,/NEO_PRE_NAVIGATION_HOOK_NOT_PROVEN/);
  assert.match(script,/missing_pre_navigation_hook/);
  assert.match(script,/neo-preload-api:/);
  assert.match(script,/connection\.apiProbe\?\.status !== "completed"/);
});


test("NEO preload health enumerates exact NEO tabs and reports named fail-closed checks",()=>{
  const agent=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  assert.match(agent,/repeat with browserWindow in windows/);
  assert.match(agent,/repeat with browserTab in tabs of browserWindow/);
  assert.match(agent,/https:\/\/app\.neo\.space/);
  assert.match(agent,/NEO_TAB_NOT_FOUND/);
  assert.match(agent,/NEO_PRELOAD_NOT_LOADED/);
  assert.match(agent,/NEO_PRE_NAVIGATION_NOT_PROVEN/);
  assert.match(agent,/NEO_ACCOUNT_BINDING_NOT_PROVEN/);
  assert.doesNotMatch(agent,/execute active tab of front window javascript/);
});
