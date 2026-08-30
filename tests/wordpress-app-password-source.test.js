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
  assert.match(agent,/const AGENT_VERSION = "2\.2\.43"/);
  assert.match(connector,/"primary_mac\.browser\.wordpress_security_repair"/);
  assert.match(connector,/action: "browser\.wordpress_enable_application_passwords"/);
  assert.match(connector,/requiredAgentVersion: "2\.2\.35"/);
});

test("canonical template and committed Mac handler cannot drift",()=>{
  const {handler}=handlerSource();
  const template=fs.readFileSync(new URL("../scripts/templates/wordpress-app-password-handler.txt",import.meta.url),"utf8").trimEnd();
  assert.equal(handler,template);
});

test("v7 selects a unique target tab and exact Hostinger Tools option signature",()=>{
  const {handler}=handlerSource();
  assert.match(handler,/admin\.php\?page=hostinger-tools/);
  assert.match(handler,/crypto\.randomUUID\(\)/);
  assert.match(handler,/targetCount is not 1/);
  assert.match(handler,/page:'hostinger-tools'/);
  assert.match(handler,/section:'security'/);
  assert.match(handler,/item:'disable application passwords'/);
  assert.match(handler,/wordpress application passwords allow users to authenticate api requests without using their main login credentials, allowing for third-party integrations\./);
  assert.match(handler,/home-section__section-item/);
  assert.match(handler,/toggle__element-container label\.toggle input\[type="checkbox"\]/);
  assert.match(handler,/input\.disabled===true/);
  assert.match(handler,/checked===classActive/);
  assert.doesNotMatch(handler,/WordfenceOptions|WFAD|loginSec_disableApplicationPasswords/);
});

test("v7 changes only the exact Hostinger toggle, reload-verifies, and remains fail closed",()=>{
  const {handler}=handlerSource();
  assert.match(handler,/label\.click\(\)/);
  assert.match(handler,/location\.reload\(\)/);
  assert.match(handler,/provider:"hostinger-tools"/);
  assert.match(handler,/setting:"disableAuthenticationPassword"/);
  assert.match(handler,/WORDPRESS_APP_PASSWORD_CONTROL_AMBIGUOUS/);
  assert.match(handler,/WORDPRESS_APP_PASSWORD_MUTATION_REJECTED/);
  assert.match(handler,/WORDPRESS_APP_PASSWORD_VERIFY_FAILED_ROLLBACK_/);
  assert.match(handler,/credentialsTransferred:false, formValuesCaptured:false/);
});
