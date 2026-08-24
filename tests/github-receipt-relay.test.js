import test from "node:test";
import assert from "node:assert/strict";
import { githubReceiptRelayInternals, validateGithubOidcClaims } from "../src/github-receipt-relay.js";

const audience="georgie-github-receipt-relay:test-nonce";
const nowMs=Date.now();
function claims(overrides={}){
  return {
    iss:"https://token.actions.githubusercontent.com",
    aud:audience,
    repository:"GirlDadMula11-sudo/Georgie",
    repository_owner:"GirlDadMula11-sudo",
    ref:"refs/heads/main",
    workflow_ref:"GirlDadMula11-sudo/Georgie/.github/workflows/georgie-receipt-relay.yml@refs/heads/main",
    event_name:"schedule",
    iat:Math.floor((nowMs-5_000)/1000),
    nbf:Math.floor((nowMs-5_000)/1000),
    exp:Math.floor((nowMs+120_000)/1000),
    ...overrides
  };
}

test("valid GitHub Actions OIDC claims are accepted",()=>{
  assert.equal(validateGithubOidcClaims(claims(),audience,{nowMs}),true);
});

test("OIDC claims fail closed for wrong repository, workflow, ref, audience, event, or stale token",()=>{
  for(const [label,override,expected] of [
    ["repository",{repository:"other/repo"},"OIDC_REPOSITORY_REJECTED"],
    ["workflow",{workflow_ref:"GirlDadMula11-sudo/Georgie/.github/workflows/other.yml@refs/heads/main"},"OIDC_WORKFLOW_REJECTED"],
    ["ref",{ref:"refs/heads/feature"},"OIDC_REF_REJECTED"],
    ["event",{event_name:"pull_request"},"OIDC_EVENT_REJECTED"],
    ["stale",{iat:Math.floor((nowMs-10*60_000)/1000)},"OIDC_TOKEN_AGE_REJECTED"]
  ]) assert.throws(()=>validateGithubOidcClaims(claims(override),audience,{nowMs}),new RegExp(expected),label);
  assert.throws(()=>validateGithubOidcClaims(claims(),"wrong-audience",{nowMs}),/OIDC_AUDIENCE_REJECTED/);
});

test("receipt payload is minimal, deterministic, marker-bound, and secret-redacted",()=>{
  const callback={
    id:"outbox-1",
    status:"completed",
    createdAt:"2026-08-24T03:00:00.000Z",
    summary:"This summary is deliberately not relayed because arbitrary model text is not part of the recovery payload.",
    evidenceRefs:["ev_safe123"],
    metadata:{
      repository:"GirlDadMula11-sudo/Georgie",
      issueNumber:68,
      commandId:"cmd_ai_control_canary_20260823_002",
      correlationId:"corr_sierra_ai_control_plane_68_canary_20260823_002",
      terminal:true
    }
  };
  const a=githubReceiptRelayInternals.receiptData(callback);
  const b=githubReceiptRelayInternals.receiptData(callback);
  assert.equal(a.receiptHash,b.receiptHash);
  assert.equal(a.marker,"<!-- georgie-receipt:cmd_ai_control_canary_20260823_002 -->");
  assert.match(a.body,/Durable Georgie receipt delivered through the GitHub OIDC recovery relay/);
  assert.doesNotMatch(a.body,/arbitrary model text/);
  assert.deepEqual(Object.keys(a).sort(),["body","commandId","correlationId","createdAt","evidenceRefs","issueNumber","marker","outboxId","receiptHash","repository","status","terminal"].sort());
});

test("secret-shaped evidence is rejected before relay",()=>{
  const callback={id:"outbox-secret",status:"blocked",createdAt:new Date(nowMs).toISOString(),evidenceRefs:["Bearer abcdefghijklmnopqrstuvwxyz123456"],metadata:{repository:"GirlDadMula11-sudo/Georgie",issueNumber:68,commandId:"cmd-safe",correlationId:"corr-safe",terminal:true}};
  assert.throws(()=>githubReceiptRelayInternals.receiptData(callback),/SECRET_SHAPED_RECEIPT_FIELD_REJECTED/);
  assert.equal(githubReceiptRelayInternals.secretShaped("github_pat_abcdefghijklmnopqrstuvwxyz1234567890"),true);
});

test("only a GitHub PAT permission blocker becomes relay eligible",()=>{
  assert.equal(githubReceiptRelayInternals.permissionBlocked({lastDeliveryError:"Resource not accessible by personal access token"}),true);
  assert.equal(githubReceiptRelayInternals.permissionBlocked({lastDeliveryError:"GitHub request failed (403)"}),true);
  assert.equal(githubReceiptRelayInternals.permissionBlocked({lastDeliveryError:"connection timed out"}),false);
});
