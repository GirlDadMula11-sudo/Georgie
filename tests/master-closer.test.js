import test from "node:test";
import assert from "node:assert/strict";
import { HUMAN_ACCESS_DISCLOSURE, buildClosingBrief, classifyClosingObjection, closingOutcomeLearningRecord, createOutboundBoundary, enforceHumanAccessHtml, enforceHumanAccessText, normalizeVerifiedOffer, prepareOutboundCorrespondence, selectNextBestAction } from "../src/master-closer.js";

test("classifies common closing objections", () => {
  assert.equal(classifyClosingObjection("The daily payment is too high").type, "payment");
  assert.equal(classifyClosingObjection("I have a better offer from another lender").type, "competitor_offer");
  assert.equal(classifyClosingObjection("Let's move forward and sign").type, "ready_to_close");
});

test("unverified offers cannot be ranked as leverage", () => {
  const brief = buildClosingBrief({
    reference: "deal-1",
    merchant: { primaryGoal: "working capital" },
    offers: [{ offerId: "o1", lender: "Lender A", amount: 100000, verified: false }],
    conversation: [{ text: "Can you do better on the payment?" }]
  });
  assert.equal(brief.verifiedOfferCount, 0);
  assert.equal(brief.bestOffer, null);
  assert.equal(brief.state, "evidence_or_discovery_required");
  assert.equal(brief.negotiationPlan.evidenceState, "discovery_required");
});

test("verified offers produce ranked closing brief without binding authority", () => {
  const brief = buildClosingBrief({
    reference: "deal-2",
    merchant: { primaryGoal: "lowest payment", targets: { amount: 100000, maxPayment: 5000, minTermMonths: 12 }, priorities: { payment: 5, term: 3, amount: 2 } },
    offers: [
      { offerId: "a", lender: "Alpha", amount: 100000, payment: 4500, termMonths: 12, totalPayback: 125000, verified: true, evidenceRefs: ["ev-a"] },
      { offerId: "b", lender: "Beta", amount: 95000, payment: 5200, termMonths: 10, totalPayback: 120000, verified: true, evidenceRefs: ["ev-b"] }
    ],
    conversation: [{ text: "The payment is my biggest concern" }]
  });
  assert.equal(brief.state, "closing_brief_ready");
  assert.equal(brief.bestOffer.offerId, "a");
  assert.equal(brief.objection.type, "payment");
  assert.equal(brief.nextBestAction.bindingActionAllowed, false);
  assert.equal(brief.nextBestAction.approvalRequired, true);
  assert.equal(brief.executionQuality.target, 0.99);
});

test("offer verification requires evidence lineage", () => {
  assert.equal(normalizeVerifiedOffer({ verified: true, evidenceRefs: [], amount: 100000 }).verified, false);
  assert.equal(normalizeVerifiedOffer({ verified: true, evidenceRefs: ["ev-1"], amount: 100000 }).verified, true);
});

test("learning rejects synthetic or unevidenced terminal outcomes", () => {
  const brief = buildClosingBrief({ reference: "deal-3", offers: [] });
  assert.throws(() => closingOutcomeLearningRecord({ brief, outcome: { status: "funded" }, evidenceRefs: [] }), /Verified outcome evidence is required/);
  assert.throws(() => closingOutcomeLearningRecord({ brief, outcome: { status: "approved" }, evidenceRefs: ["ev"] }), /terminal status/);
  const record = closingOutcomeLearningRecord({ brief, outcome: { status: "funded", lender: "Alpha" }, evidenceRefs: ["ev-funded"] });
  assert.equal(record.synthetic, false);
  assert.equal(record.status, "funded");
});

for (const path of ["new", "reply", "follow-up", "template", "retry"]) test(`${path} disclosure is exactly once immediately before signature`, () => {
  const input = `Hello\n\nIf you want a human, contact Jason Sierra or Louri Brown.\n\nBest,\nGeorgie`;
  const value = enforceHumanAccessText(input);
  assert.equal(value.split(HUMAN_ACCESS_DISCLOSURE).length - 1, 1);
  assert.match(value, new RegExp(`${HUMAN_ACCESS_DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\n\\nBest,`));
});

test("HTML disclosure is normalized and placed before signature", () => {
  const value = enforceHumanAccessHtml("<p>Hello</p><p>Speak with human Jason Sierra or Louri Brown.</p><p>Georgie<br>Sierra</p>");
  assert.equal((value.match(/data-georgie-human-access/g) || []).length, 1);
  assert.ok(value.indexOf("data-georgie-human-access") < value.indexOf("Georgie"));
});

test("concurrent retries deliver exactly once and audit the correlated send", async () => {
  let deliveries = 0; const events = [];
  const send = createOutboundBoundary({ deliver: async () => { deliveries += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { messageId: "m1" }; }, audit: async (event) => events.push(event) });
  const message = { idempotencyKey:"deal-1:reply-1", correlationId:"corr-1", rationale:"Obtain verified stipulation", evidenceState:{ ids:["e1"] }, text:"Hello\n\nGeorgie" };
  const results = await Promise.all(Array.from({ length: 20 }, () => send(message)));
  assert.equal(deliveries, 1); assert.equal(events.filter((e) => e.status === "sent").length, 1); assert.equal(results.every((r) => r.provider.messageId === "m1"), true);
  assert.equal((await send(message)).deduplicated, true); assert.equal(deliveries, 1);
});

test("next best action is grounded in authoritative evidence", () => {
  const evidence = [{ id:"e1", status:"verified", source:"sierra", observedAt:new Date().toISOString() }];
  assert.equal(selectNextBestAction({ audience:"client", deal:{ stipulations:[{ id:"bank-statements", status:"missing" }] }, evidence }).action, "resolve_stipulation");
  assert.equal(selectNextBestAction({ audience:"client", deal:{ offer:{ status:"verified" } }, evidence }).action, "clarify_verified_offer");
  assert.equal(selectNextBestAction({ audience:"client", deal:{ accepted:true, funding:{ status:"pending" } }, evidence }).action, "progress_funding");
});

test("missing, contradictory, stale, and authority-sensitive evidence escalates", () => {
  assert.equal(selectNextBestAction({ evidence:[] }).sendAllowed, false);
  const base = { id:"e1", status:"authoritative", source:"lender", observedAt:new Date().toISOString() };
  assert.equal(selectNextBestAction({ evidence:[{...base,contradicted:true}] }).reason, "contradictory_evidence");
  assert.equal(selectNextBestAction({ evidence:[{...base,expiresAt:"2020-01-01T00:00:00Z"}] }).reason, "stale_evidence");
  assert.equal(selectNextBestAction({ evidence:[base], requestedNegotiation:{ withinAuthority:false } }).reason, "authority_sensitive_negotiation");
});

test("unverified terms, approvals, deadlines, and pending escalation fail closed", () => {
  const base={idempotencyKey:"claim-1",rationale:"Clarify offer",evidenceState:{claims:[]},text:"Hello\nGeorgie"};
  for(const type of ["approval","term","lender_position","deadline","document","authority","commitment"]) assert.throws(()=>prepareOutboundCorrespondence({...base,evidenceState:{claims:[{type,status:"inferred"}]}}),/UNVERIFIED/);
  assert.throws(()=>prepareOutboundCorrespondence({...base,escalation:{required:true,approved:false}}),/HUMAN_ESCALATION_REQUIRED/);
});

test("restart recovery deduplicates sent records and quarantines uncertain attempts", async () => {
  let deliveries=0;
  const base={idempotencyKey:"restart-1",rationale:"Follow up",evidenceState:{claims:[]},text:"Hello\nGeorgie"};
  const sent=createOutboundBoundary({deliver:async()=>{deliveries+=1;},audit:async()=>{},lookup:async()=>({status:"sent",provider:{messageId:"prior"}})});
  assert.equal((await sent(base)).deduplicated,true); assert.equal(deliveries,0);
  const uncertain=createOutboundBoundary({deliver:async()=>{deliveries+=1;},audit:async()=>{},lookup:async()=>({status:"attempted"})});
  await assert.rejects(()=>uncertain({...base,idempotencyKey:"restart-2"}),/STATE_UNCERTAIN/); assert.equal(deliveries,0);
});
