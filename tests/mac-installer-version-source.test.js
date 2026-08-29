import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Mac installer derives its expected version from agent source",()=>{
  const installer=fs.readFileSync(new URL("../mac-agent/install.sh",import.meta.url),"utf8");
  assert.match(installer,/EXPECTED_AGENT_VERSION=.*AGENT_VERSION/);
  assert.doesNotMatch(installer,/EXPECTED_AGENT_VERSION="2\.2\./);
});

test("daemon health instrumentation is version-idempotent",()=>{
  const installer=fs.readFileSync(new URL("../mac-agent/install-daemon-health.mjs",import.meta.url),"utf8");
  assert.match(installer,/sourceAgentVersion/);
  assert.doesNotMatch(installer,/versionOld|versionNew|2\.2\.35/);
});
