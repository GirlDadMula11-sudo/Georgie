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

test("NEO observation script supports exact multi-account identity in one tab and bounded account-only selection",()=>{
  const script=buildNeoObservationScript({mailboxes,cursors:{},limit:999});
  assert.match(script,/neo_browser/);assert.match(script,/exact objective-envelope mailbox binding not found/);assert.match(script,/messages:\s*messages\.slice\(0,\s*max\)/);
  assert.match(script,/accountSelectionPerformed/);assert.match(script,/exact mailbox account rail control not found/);
  assert.match(script,/exact_envelope_bound_account_rail/);assert.match(script,/innerWidth \* 0\.38/);
  assert.match(script,/domain\.slice\(0, 4\)/);assert.ok(script.includes("..."));
  assert.match(script,/messageRowsClicked/);assert.match(script,/messageOpeningPerformed/);
  assert.doesNotMatch(script,/row\.click\s*\(/);assert.doesNotMatch(script,/location\s*=/);assert.doesNotMatch(script,/fetch\s*\(/);assert.doesNotMatch(script,/XMLHttpRequest/);
  assert.match(script,/navigationPerformed:false/);assert.match(script,/mailboxMutation:false/);
});

test("NEO observation validation fails closed on ambiguity, missing identity, or mutation",()=>{
  const connected=Object.fromEntries(mailboxes.map(mailbox=>[mailbox,{connected:true,provider:"neo_browser",readOnly:true}]));
  assert.equal(validateNeoObservation({provider:"neo_browser",navigationPerformed:false,messageOpeningPerformed:false,mailboxMutation:false,mailboxes:connected,messages:[]},mailboxes).provider,"neo_browser");
  assert.throws(()=>validateNeoObservation({provider:"neo_browser",navigationPerformed:false,messageOpeningPerformed:false,mailboxMutation:false,mailboxes:{},messages:[]},mailboxes),/IDENTITY_NOT_VERIFIED/);
  assert.throws(()=>validateNeoObservation({provider:"neo_browser",navigationPerformed:true,messageOpeningPerformed:false,mailboxMutation:false,mailboxes:connected,messages:[]},mailboxes),/READ_ONLY_PROOF_FAILED/);
  assert.throws(()=>validateNeoObservation({provider:"neo_browser",navigationPerformed:false,messageOpeningPerformed:true,mailboxMutation:false,mailboxes:connected,messages:[]},mailboxes),/READ_ONLY_PROOF_FAILED/);
});
