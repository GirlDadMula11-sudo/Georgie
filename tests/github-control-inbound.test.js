import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { validateGithubControlOidcClaims } from "../src/github-control-inbound.js";

const now=Math.floor(Date.now()/1000);
const audience="georgie-github-control-inbound:test";
const common={iss:"https://token.actions.githubusercontent.com",aud:audience,repository:"GirlDadMula11-sudo/Georgie",repository_owner:"GirlDadMula11-sudo",iat:now,exp:now+300};
const relayPath="GirlDadMula11-sudo/Georgie/.github/workflows/georgie-receipt-relay.yml";
const pushClaims={...common,ref:"refs/heads/georgie-control",workflow_ref:`${relayPath}@refs/heads/georgie-control`,event_name:"push"};
const scheduledClaims={...common,ref:"refs/heads/main",workflow_ref:`${relayPath}@refs/heads/main`,event_name:"schedule"};
const manualClaims={...scheduledClaims,event_name:"workflow_dispatch"};

test("inbound OIDC accepts registered receipt relay on isolated push branch and main recovery events",()=>{
  assert.equal(validateGithubControlOidcClaims(pushClaims,audience),true);
  assert.equal(validateGithubControlOidcClaims(scheduledClaims,audience),true);
  assert.equal(validateGithubControlOidcClaims(manualClaims,audience),true);
  for(const patch of [
    {repository:"other/repo"},
    {repository_owner:"someone-else"},
    {ref:"refs/heads/main"},
    {workflow_ref:"GirlDadMula11-sudo/Georgie/.github/workflows/other.yml@refs/heads/georgie-control"},
    {event_name:"issue_comment"},
    {event_name:"pull_request"},
    {aud:"wrong-audience"}
  ]) assert.throws(()=>validateGithubControlOidcClaims({...pushClaims,...patch},audience));
  assert.throws(()=>validateGithubControlOidcClaims({...manualClaims,ref:"refs/heads/georgie-control"},audience));
});

test("inbound OIDC rejects stale tokens",()=>{
  assert.throws(()=>validateGithubControlOidcClaims({...pushClaims,iat:now-600,exp:now+30},audience));
  assert.throws(()=>validateGithubControlOidcClaims({...pushClaims,exp:now-60},audience));
});


test("GitHub control fallback is signal-bound and not hardcoded to one legacy objective",()=>{
  const workflow=fs.readFileSync(new URL("../.github/workflows/georgie-receipt-relay.yml",import.meta.url),"utf8");
  assert.doesNotMatch(workflow,/Control signal must target issue #117/);
  assert.doesNotMatch(workflow,/cmd_master_closer_fallback_probe_20260823/);
  assert.match(workflow,/Control comment objective does not match signal/);
  assert.match(workflow,/Control comment command does not match signal/);
  assert.match(workflow,/Control comment idempotency does not match signal/);
});


test("GitHub OIDC fallback admits into the governed connector with canonical identity",()=>{
  const source=fs.readFileSync(new URL("../src/github-control-inbound.js",import.meta.url),"utf8");
  const installer=fs.readFileSync(new URL("../scripts/install-github-receipt-relay.mjs",import.meta.url),"utf8");
  assert.match(source,/createGovernedConnector/);
  assert.match(source,/connector\.submit/);
  assert.match(source,/source:"github_ai_control"/);
  assert.match(source,/connectorCommandId:admitted\.commandId/);
  assert.match(installer,/createGithubControlInboundRouter\(\{executeCommand:/);
  assert.match(installer,/legacyInboundMount/);
  assert.match(installer,/server\.replace\(legacyInboundMount,inboundMount\)/);
});

test("GitHub OIDC fallback exposes authenticated governed command status receipts",()=>{
  const source=fs.readFileSync(new URL("../src/github-control-inbound.js",import.meta.url),"utf8");
  const workflow=fs.readFileSync(new URL("../.github/workflows/georgie-receipt-relay.yml",import.meta.url),"utf8");
  assert.match(source,/router\.post\("\/status"/);
  assert.match(source,/connector\.status\(userId,commandId\)/);
  assert.match(workflow,/georgie-command-status:/);
  assert.match(workflow,/publish_command_status/);
  assert.match(workflow,/\$GEORGIE_INBOUND_URL\/status/);
});


test("GitHub status receipt normalizes singular and plural Mac jobs",()=>{\n  const workflow=fs.readFileSync(new URL("../.github/workflows/georgie-receipt-relay.yml",import.meta.url),"utf8");\n  assert.match(workflow,/if \.command\.macJob then \[\.command\.macJob\]/);\n  assert.match(workflow,/Command error:/);\n});\n