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
  assert.match(script,/neo_browser/);assert.match(script,/exact mailbox identity not found/);assert.match(script,/messages:messages\.slice\(0,max\)/);
  assert.match(script,/accountSelectionPerformed/);assert.match(script,/exact mailbox account control not found/);
  assert.match(script,/messageRowsClicked:false/);assert.match(script,/messageOpeningPerformed:false/);
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
