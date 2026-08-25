import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function handlerSource() {
  const agent=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  const start=agent.indexOf("async function enableWordpressApplicationPasswords");
  const end=agent.indexOf("\nasync function ",start+20);
  assert.ok(start>=0&&end>start);
  return {agent,handler:agent.slice(start,end).trimEnd()};
}

test("WordPress Application Password capability is committed to distributable source",()=>{
  const {agent}=handlerSource();
  const connector=fs.readFileSync(new URL("../src/governed-connector.js",import.meta.url),"utf8");
  assert.match(agent,/case "browser\.wordpress_enable_application_passwords"/);
  assert.match(agent,/const AGENT_VERSION = "2\.2\.34"/);
  assert.match(connector,/"primary_mac\.browser\.wordpress_security_repair"/);
  assert.match(connector,/action: "browser\.wordpress_enable_application_passwords"/);
  assert.match(connector,/requiredAgentVersion: "2\.2\.34"/);
});

test("canonical template and committed Mac handler cannot drift",()=>{
  const {handler}=handlerSource();
  const template=fs.readFileSync(new URL("../scripts/templates/wordpress-app-password-handler.txt",import.meta.url),"utf8").trimEnd();
  assert.equal(handler,template);
});

test("v7 selects a unique target tab and exact Wordfence option signature",()=>{
  const {handler}=handlerSource();
  assert.match(handler,/admin\.php\?page=WordfenceOptions/);
  assert.match(handler,/crypto\.randomUUID\(\)/);
  assert.match(handler,/if tabUrl is \$\{JSON\.stringify\(targetUrl\)\}/);
  assert.match(handler,/wf-option-loginSec-disableApplicationPasswords/);
  assert.match(handler,/data-option="\'\+expected\.option\+\'"/);
  assert.match(handler,/loginSec_disableApplicationPasswords/);
  assert.match(handler,/wf-option-checkbox\[role="checkbox"\]/);
  assert.match(handler,/wf-option-loginSec-disableApplicationPasswords-label/);
  assert.doesNotMatch(handler,/input\[type="checkbox"\]/);
});

test("v7 saves only one clean Wordfence pending change and remains fail closed",()=>{
  const {handler}=handlerSource();
  assert.match(handler,/Object\.keys\(WFAD\.pendingChanges\)\.length!==0/);
  assert.match(handler,/keys\.length!==1\|\|keys\[0\]!==option/);
  assert.match(handler,/querySelectorAll\('#wf-save-changes'\)/);
  assert.match(handler,/WORDPRESS_APP_PASSWORD_CONTROL_AMBIGUOUS/);
  assert.match(handler,/WORDPRESS_APP_PASSWORD_MUTATION_REJECTED/);
  assert.match(handler,/WORDPRESS_APP_PASSWORD_VERIFY_FAILED_ROLLBACK_/);
  assert.match(handler,/credentialsTransferred:false, formValuesCaptured:false/);
});
