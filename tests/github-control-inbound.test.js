import test from "node:test";
import assert from "node:assert/strict";
import { validateGithubControlOidcClaims } from "../src/github-control-inbound.js";

const now=Math.floor(Date.now()/1000);
const audience="georgie-github-control-inbound:test";
const base={iss:"https://token.actions.githubusercontent.com",aud:audience,repository:"GirlDadMula11-sudo/Georgie",repository_owner:"GirlDadMula11-sudo",ref:"refs/heads/main",workflow_ref:"GirlDadMula11-sudo/Georgie/.github/workflows/georgie-control-inbound.yml@refs/heads/main",event_name:"workflow_dispatch",iat:now,exp:now+300};

test("inbound OIDC accepts only the exact Georgie main workflow",()=>{
  assert.equal(validateGithubControlOidcClaims(base,audience),true);
  for(const event_name of ["schedule","issue_comment","push"]) assert.equal(validateGithubControlOidcClaims({...base,event_name},audience),true);
  for(const patch of [
    {repository:"other/repo"},
    {repository_owner:"someone-else"},
    {ref:"refs/heads/feature"},
    {workflow_ref:"GirlDadMula11-sudo/Georgie/.github/workflows/other.yml@refs/heads/main"},
    {event_name:"pull_request"},
    {event_name:"issues"},
    {aud:"wrong-audience"}
  ]) assert.throws(()=>validateGithubControlOidcClaims({...base,...patch},audience));
});

test("inbound OIDC rejects stale tokens",()=>{
  assert.throws(()=>validateGithubControlOidcClaims({...base,iat:now-600,exp:now+30},audience));
  assert.throws(()=>validateGithubControlOidcClaims({...base,exp:now-60},audience));
});
