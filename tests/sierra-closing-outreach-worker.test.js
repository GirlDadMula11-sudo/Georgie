import test from "node:test";
import assert from "node:assert/strict";
import { evaluateClosingOutreachCandidate, executeClosingOutreachCandidate, runSierraClosingOutreachCycle } from "../src/sierra-closing-outreach-worker.js";

const deal={reference_number:"SCA-100",legal_business_name:"Acme LLC",first_name:"Alex",client_email:"alex@example.com",stage_status:"offer_received",available_offers:1};
const verified={offer_id:"offer-1",status:"verified",evidence_refs:["evidence-1"]};

test("requires exact deal identity, client email, and evidence-backed verified offer",()=>{
  assert.equal(evaluateClosingOutreachCandidate({deal:{...deal,reference_number:""},offers:[verified]}).reason,"DEAL_IDENTITY_MISSING");
  assert.equal(evaluateClosingOutreachCandidate({deal:{...deal,client_email:""},offers:[verified]}).reason,"CLIENT_EMAIL_MISSING");
  assert.equal(evaluateClosingOutreachCandidate({deal,offers:[{...verified,evidence_refs:[]}]}).reason,"VERIFIED_OFFER_EVIDENCE_MISSING");
  assert.equal(evaluateClosingOutreachCandidate({deal,offers:[verified]}).eligible,true);
});

test("terminal deals and previously recorded offer snapshots cannot send",()=>{
  assert.equal(evaluateClosingOutreachCandidate({deal:{...deal,stage_status:"funded"},offers:[verified]}).reason,"DEAL_TERMINAL");
  const first=evaluateClosingOutreachCandidate({deal,offers:[verified]});
  const prior={event_type:"georgie_verified_offer_closing_outreach",idempotency_key:first.idempotencyKey};
  assert.equal(evaluateClosingOutreachCandidate({deal,offers:[verified],auditEvents:[prior]}).reason,"OUTREACH_ALREADY_RECORDED");
});

test("send completion requires provider receipt and Sierra CRM readback",async()=>{
  const sent=[]; const recorded=[];
  const result=await executeClosingOutreachCandidate({deal,offers:[verified],auditEvents:[],selectMailbox:()=>({id:"closer"}),send:async(id,message)=>{sent.push({id,message});return{messageId:"provider-1",accepted:[message.to],rejected:[],from:"georgie@example.com",to:message.to};},record:async(userId,input)=>{recorded.push({userId,input});return{verification:{ok:true}};}});
  assert.equal(result.status,"sent_verified"); assert.equal(result.providerMessageId,"provider-1"); assert.equal(result.crmReadBack,true);
  assert.equal(sent.length,1); assert.match(sent[0].message.rationale,/Immediately/); assert.equal(sent[0].message.evidenceState.claims[0].status,"verified");
  assert.equal(recorded.length,1); assert.equal(recorded[0].input.eventType,"georgie_verified_offer_closing_outreach");
});

test("provider ambiguity and incomplete CRM verification fail closed",async()=>{
  await assert.rejects(()=>executeClosingOutreachCandidate({deal,offers:[verified],selectMailbox:()=>({id:"closer"}),send:async()=>({messageId:null,accepted:[],rejected:[]}),record:async()=>({verification:{ok:true}})}),/PROVIDER_RECEIPT_INCOMPLETE/);
  await assert.rejects(()=>executeClosingOutreachCandidate({deal,offers:[verified],selectMailbox:()=>({id:"closer"}),send:async(id,message)=>({messageId:"m1",accepted:[message.to],rejected:[]}),record:async()=>({verification:{ok:false}})}),/CRM_READBACK_INCOMPLETE/);
});

test("restart deduplication verifies readback without claiming another send",async()=>{
  const result=await executeClosingOutreachCandidate({deal,offers:[verified],selectMailbox:()=>({id:"closer"}),send:async(id,message)=>({messageId:"existing-m1",accepted:[message.to],rejected:[],deduplicated:true}),record:async()=>({verification:{ok:true}})});
  assert.equal(result.status,"deduplicated_verified");
});

test("cycle independently inspects each active deal and sends eligible files once",async()=>{
  const executed=[];
  const result=await runSierraClosingOutreachCycle({portfolio:async()=>({deals:[deal,{...deal,reference_number:"SCA-101"}]}),deal:async(userId,reference)=>({...deal,reference_number:reference}),offers:async()=>({offers:[verified]}),audit:async()=>[],execute:async input=>{executed.push(input.deal.reference_number);return{status:"sent_verified"};}});
  assert.deepEqual(executed,["SCA-100","SCA-101"]); assert.equal(result.inspected,2); assert.equal(result.sent,2);
});
