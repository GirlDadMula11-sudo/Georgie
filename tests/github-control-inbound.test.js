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
