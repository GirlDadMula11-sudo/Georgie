import test from "node:test";
import assert from "node:assert/strict";
import { buildNeoObservationScript, isAllowedNeoUrl, validateNeoObservation } from "../mac-agent/neo-mail-reader.js";

const mailboxes=["submissions@sierramarketinginc.com","jasonsierra@sierramarketinginc.com"];

test("NEO adapter accepts only neo.space browser origins",()=>{
  assert.equal(isAllowedNeoUrl("https://mail.neo.space/inbox"),true);
  assert.equal(isAllowedNeoUrl("https://neo.space/"),true);
  assert.equal(isAllowedNeoUrl("https://mail.google.com/"),false);
  assert.equal(isAllowedNeoUrl("https://neo.space.evil.example/"),false);
});

test("NEO observation script supports exact multi-account identity and guarded full-body retrieval",()=>{
  const script=buildNeoObservationScript({mailboxes,cursors:{},limit:999});
  assert.match(script,/neo_browser/);assert.match(script,/exact objective-envelope mailbox binding not found/);assert.match(script,/messages:\s*messages\.slice\(0,\s*max\)/);
  assert.match(script,/accountSelectionPerformed/);assert.match(script,/exact mailbox account rail control not found/);
  assert.match(script,/exact_envelope_bound_account_rail/);assert.doesNotMatch(script,/innerWidth \*/);assert.doesNotMatch(script,/function neo\(raw\)\{try\{const h=new URL/);assert.match(script,/function neo\(raw\)\{const match=String/);assert.match(script,/tabsEnumerated/);assert.match(script,/neoTabOrigins/);
  assert.match(script,/root\.body\?\.innerText/);assert.match(script,/matchesIdentity\(normalized\(root\.body/);assert.match(script,/a\.left - b\.left/);
  assert.match(script,/domain\.slice\(0, 4\)/);assert.ok(script.includes("..."));
  assert.ok(script.includes("\\\\u2026"));assert.match(script,/u200B/);assert.match(script,/uniqueLocal/);assert.match(script,/shadowRoot/);assert.match(script,/contentDocument/);
  assert.match(script,/unique_requested_identity_token/);assert.match(script,/identityProbeErrors/);assert.match(script,/NEO browser identity probe failed/);
  assert.match(script,/messageRowsClicked/);assert.match(script,/guardedMessageOpeningPerformed/);assert.match(script,/row\.click\s*\(/);
  assert.match(script,/GEORGIE_READ_ONLY_BLOCK/);assert.match(script,/same_origin_https_get_head_only/);assert.match(script,/endpoint\.origin !== location\.origin/);assert.match(script,/navigator\.sendBeacon/);assert.match(script,/WebSocket\.prototype\.send/);
  assert.match(script,/bodyComplete/);assert.match(script,/bodyTruncated/);assert.match(script,/maxBodyBytes=200000/);assert.match(script,/data-message-id/);assert.match(script,/data-thread-id/);assert.match(script,/same-origin-link/);assert.match(script,/messageIdSource/);assert.match(script,/threadIdSource/);assert.match(script,/ambiguous immutable message id/);assert.doesNotMatch(script,/messageId.*sha256|messageId.*rowIndex|messageId.*Date\.now/);
  assert.doesNotMatch(script,/location\s*=/);assert.match(script,/navigationPerformed:false/);assert.match(script,/mailboxMutation:false/);assert.match(script,/credentialsTransferred:false/);
  assert.ok(script.includes('[\\"GET\\", \\"HEAD\\"]'));assert.match(script,/blockedMutationCount/);
  assert.match(script,/message\.readStateBefore !== \\"unknown\\"/);assert.match(script,/message\.readStateBefore === readStateAfter/);
});

test("NEO observation validation fails closed on identity, mutation, credential transfer, or partial bodies",()=>{
  const connected=Object.fromEntries(mailboxes.map(mailbox=>[mailbox,{connected:true,provider:"neo_browser",readOnly:true}]));
  const base={provider:"neo_browser",navigationPerformed:false,messageOpeningPerformed:false,mailboxMutation:false,credentialsTransferred:false,fullBodyGate:true,mailboxes:connected,messages:[]};
  assert.equal(validateNeoObservation(base,mailboxes).provider,"neo_browser");
  assert.throws(()=>validateNeoObservation({...base,mailboxes:{}},mailboxes),/IDENTITY_NOT_VERIFIED/);
  assert.throws(()=>validateNeoObservation({...base,navigationPerformed:true},mailboxes),/READ_ONLY_PROOF_FAILED/);
  assert.throws(()=>validateNeoObservation({...base,messageOpeningPerformed:true},mailboxes),/READ_ONLY_PROOF_FAILED/);
  assert.throws(()=>validateNeoObservation({...base,credentialsTransferred:true},mailboxes),/READ_ONLY_PROOF_FAILED/);
  const complete={messageId:"m1",bodyComplete:true,bodyTruncated:false,readStateNeutral:true,mailboxMutation:false,credentialsTransferred:false,retrievalMethod:"guarded_dom_open"};
  assert.equal(validateNeoObservation({...base,messages:[complete]},mailboxes).messages.length,1);
  assert.throws(()=>validateNeoObservation({...base,messages:[{...complete,bodyComplete:false}]},mailboxes),/FULL_BODY_PROOF_FAILED/);
});
