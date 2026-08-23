import test from "node:test";
import assert from "node:assert/strict";
import { buildNeoObservationScript, isAllowedNeoUrl, validateNeoObservation, buildNeoStaticContractInspectionScript, validateNeoStaticContractInspection } from "../mac-agent/neo-mail-reader.js";

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


test("NEO immutable IDs inspect row-bound framework state without storage or credential export",()=>{
  const script=buildNeoObservationScript({mailboxes,cursors:{},limit:2});
  assert.match(script,/row-bound-runtime/);
  assert.match(script,/reactProps|reactFiber/);
  assert.match(script,/vueParentComponent/);
  assert.match(script,/runtimeStateSurfaces/);
  assert.match(script,/token\|secret\|password\|cookie\|authorization\|session/);
  assert.doesNotMatch(script,/localStorage\.getItem|sessionStorage\.getItem|document\.cookie/);
  assert.match(script,/stableRuntime/);
});


test("NEO source probe is same-origin GET-only and excludes credentials and body fields",()=>{
 const script=buildNeoObservationScript({mailboxes,cursors:{},limit:2});
 assert.match(script,/sameOriginOnly/);assert.match(script,/methods/);assert.match(script,/GET/);assert.match(script,/credentials/);assert.match(script,/same-origin/);assert.match(script,/mail\|message\|thread\|conversation\|inbox/);assert.match(script,/body\|html\|content\|attachment/);assert.match(script,/token\|secret\|password\|authorization\|session\|cookie/);assert.doesNotMatch(script,/POST|PUT|PATCH|DELETE/);
});


test("NEO static contract inspection is bundle-only, credentialless, and fail closed",()=>{
  const script=buildNeoStaticContractInspectionScript({objectiveId:"SIERRA-LI-MBX-20260823-001"});
  assert.match(script,/neo_static_bundle_contracts/);
  assert.match(script,/credentialsMode/);
  assert.match(script,/credentialsMode/);
  assert.match(script,/static.*js/);
  assert.doesNotMatch(script,/accountActivator/);
  assert.doesNotMatch(script,/guardedOpener/);
});

test("NEO static contract proof authorizes no source and accesses no mailbox data",()=>{
  const observed={provider:"neo_static_bundle_contracts",objectiveId:"SIERRA-LI-MBX-20260823-001",tabsInspected:1,inspections:[{status:"completed",credentialsTransferred:false,mailboxDataAccessed:false,mailboxInteractionPerformed:false,authorizationBlocked:true,bundles:[{path:"/static/js/mail.9adeadc4.js",sha256:"a".repeat(64),bytes:10}],contracts:[],stores:[]}],credentialsTransferred:false,mailboxDataAccessed:false,mailboxInteractionPerformed:false,authorizedReadSource:null,authorizationBlocked:true};
  assert.equal(validateNeoStaticContractInspection(observed,observed.objectiveId),observed);
  assert.throws(()=>validateNeoStaticContractInspection({...observed,authorizedReadSource:{origin:"https://api.example"}},observed.objectiveId),/PROOF_FAILED/);
  assert.throws(()=>validateNeoStaticContractInspection({...observed,mailboxDataAccessed:true},observed.objectiveId),/PROOF_FAILED/);
});


test("NEO static resolver analyzes only bounded provider-anchor windows",()=>{
  const script=buildNeoStaticContractInspectionScript({objectiveId:"SIERRA-LI-MBX-20260823-001"});
  assert.match(script,/api\.flockmail\.com/);
  assert.match(script,/bll\.flockmail\.com/);
  assert.match(script,/ae\\\/ws\\\/create|ae\/ws\/create/);
  assert.match(script,/routeResolutions/);
  assert.match(script,/immutableIdFields/);
  assert.match(script,/contextHash/);
  assert.match(script,/authorizationBlocked:true/);
  assert.doesNotMatch(script,/accountActivator/);
  assert.doesNotMatch(script,/messageOpeningPerformed:true/);
});
