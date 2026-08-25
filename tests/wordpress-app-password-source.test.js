import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("WordPress Application Password capability is committed to distributable source",()=>{
  const agent=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  const connector=fs.readFileSync(new URL("../src/governed-connector.js",import.meta.url),"utf8");
  assert.match(agent,/async function enableWordpressApplicationPasswords/);
  assert.match(agent,/case "browser\.wordpress_enable_application_passwords"/);
  assert.match(connector,/"primary_mac\.browser\.wordpress_security_repair"/);
  assert.match(connector,/action: "browser\.wordpress_enable_application_passwords"/);
});
