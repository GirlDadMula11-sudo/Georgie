import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const manifest=JSON.parse(fs.readFileSync(new URL("../mac-agent/neo-preload-extension/manifest.json",import.meta.url),"utf8"));
const source=fs.readFileSync(new URL("../mac-agent/neo-preload-extension/preload.js",import.meta.url),"utf8");
const background=fs.readFileSync(new URL("../mac-agent/neo-preload-extension/background.js",import.meta.url),"utf8");
const diagnostic=fs.readFileSync(new URL("../mac-agent/neo-preload-extension/diagnostic.js",import.meta.url),"utf8");

test("NEO preload is narrowly scoped and runs in the page main world before navigation",()=>{
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.host_permissions,["https://app.neo.space/*"]);
  assert.deepEqual(manifest.permissions,["debugger"]);
  assert.equal(manifest.background.service_worker,"background.js");
  assert.equal(manifest.background.type,undefined);
  assert.equal(manifest.content_scripts.length,1);
  const diagnosticScript=manifest.content_scripts[0];
  assert.equal(diagnosticScript.world,"ISOLATED");
  assert.deepEqual(diagnosticScript.matches,["https://app.neo.space/*"]);
  assert.deepEqual(diagnosticScript.js,["diagnostic.js"]);
  assert.equal(diagnosticScript.run_at,"document_start");
  assert.match(background,/chrome\.debugger\.attach/);
  assert.match(background,/Runtime\.evaluate/);
  assert.match(background,/chrome\.debugger\.detach/);
  assert.match(background,/NEO_DEBUGGER_SESSION_VERIFIED/);
  assert.doesNotMatch(background,/registerContentScripts/);
  assert.match(background,/GEORGIE_NEO_EXTENSION_DIAGNOSTIC/);
  assert.match(background,/GEORGIE_NEO_DEBUGGER_VERIFY/);
  assert.match(diagnostic,/georgieNeoExtensionDiagnostic/);
  assert.match(diagnostic,/SERVICE_WORKER_UNREACHABLE/);
  assert.doesNotMatch(diagnostic,/document\\.cookie|authorization|token|request\\.body|message content/i);
});

test("NEO debugger relay is content-neutral and fail closed",()=>{
  assert.match(diagnostic,/georgieNeoDebuggerRequest/);
  assert.match(diagnostic,/georgieNeoDebuggerResult/);
  assert.match(background,/messageContentAccessed: false/);
  assert.match(background,/credentialsTransferred: false/);
  assert.match(background,/mutationPerformed: false/);
  assert.doesNotMatch(background,/Network\.getAllCookies|Storage\.getCookies|document\.cookie|localStorage|sessionStorage/);
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
  assert.match(agent,/NEO_EXTENSION_REGISTRATION_ERROR/);
  assert.match(agent,/extensionDiagnostic\.message/);
  assert.match(agent,/slice\(0,240\)/);
  assert.match(agent,/NEO_EXTENSION_DIAGNOSTIC_NOT_PRESENT/);
  assert.match(agent,/NEO_ACCOUNT_BINDING_NOT_PROVEN/);
  assert.doesNotMatch(agent,/execute active tab of front window javascript/);
});

test("NEO preload installer reopens only the scoped NEO mail page",()=>{
  const agent=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  assert.match(agent,/--load-extension=/);
  assert.match(agent,/https:\/\/app\.neo\.space\/mail\//);
  assert.doesNotMatch(agent,/gmail\.com|mail\.apple\.com/);
});

test("Mac self-update schedules restart only after returning a completion receipt",()=>{
  const agent=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  assert.match(agent,/setTimeout\(\(\) =>/);
  assert.match(agent,/spawn\("\/bin\/bash"/);
  assert.match(agent,/restartScheduled: true/);
  assert.doesNotMatch(agent,/const install = await runDeveloper\("\/bin\/bash"/);
});

test("NEO installer eliminates the extension registration race with one scoped reload",()=>{
  const agent=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  assert.match(agent,/setTimeout\(resolve, 4000\)/);
  assert.match(agent,/reload browserTab/);
  assert.match(agent,/NEO_POST_REGISTRATION_RELOAD_FAILED/);
  assert.match(agent,/postRegistrationReload: true/);
});
