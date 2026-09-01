const clean = (value, max = 1000) => String(value ?? "").trim().slice(0, max);
const list = (value, max = 20) => (Array.isArray(value) ? value : []).filter(Boolean).slice(0, max).map(item => clean(item, 500));
const observed = (value, confidence, evidence = []) => ({ value, confidence, evidence: list(evidence, 8) });

const SIGNALS = {
  analytical: /numbers?|data|compare|roi|return|cost|details?|breakdown|how (?:does|would)|evidence/i,
  rushed: /quick|brief|short|hurry|busy|no time|bottom line/i,
  skeptical: /prove|trust|legit|scam|catch|too good|believe|guarantee/i,
  confused: /confus|don't understand|not clear|what does|explain/i,
  frustrated: /frustrat|annoy|upset|tired of|waste|again|ridiculous/i,
  interested: /interested|sounds good|tell me more|move forward|ready|sign|start/i,
  priceSensitive: /price|cost|expensive|budget|afford|rate|payment|cheaper/i,
  authorityLimited: /partner|boss|team|board|wife|husband|co-owner|decision maker|need approval/i,
  hesitant: /think about|not sure|maybe|concern|worr|risk|hesitat|later/i
};

export function normalizeProductIntelligence(product = {}) {
  const evidenceRefs = list(product.evidenceRefs || product.evidence_refs, 50);
  const claims = (Array.isArray(product.claims) ? product.claims : []).slice(0, 50).map(claim => ({
    text: clean(claim?.text || claim?.claim, 700),
    status: clean(claim?.status, 40).toLowerCase() || "unverified",
    evidenceRefs: list(claim?.evidenceRefs || claim?.evidence_refs, 20)
  })).filter(claim => claim.text);
  const verifiedClaims = claims.filter(claim => ["verified", "authoritative"].includes(claim.status) && claim.evidenceRefs.length);
  const stale = Boolean(product.expiresAt && Date.parse(product.expiresAt) <= Date.now());
  return {
    contract: "georgie.product-intelligence.v1",
    productId: clean(product.productId || product.id, 160),
    name: clean(product.name, 200),
    family: clean(product.family || product.category, 120) || "general",
    version: clean(product.version, 80) || "unversioned",
    audience: list(product.audience, 20),
    pains: list(product.pains, 30),
    outcomes: list(product.outcomes, 30),
    differentiators: list(product.differentiators, 30),
    proof: list(product.proof, 30),
    pricing: product.pricing ?? null,
    packages: Array.isArray(product.packages) ? product.packages.slice(0, 20) : [],
    qualification: list(product.qualification, 30),
    disqualifiers: list(product.disqualifiers, 30),
    fulfillment: list(product.fulfillment, 30),
    constraints: list(product.constraints, 40),
    concessionAuthority: product.concessionAuthority === true,
    evidenceRefs,
    verifiedClaims,
    status: stale ? "stale" : clean(product.productId || product.id, 160) && clean(product.name, 200) && (evidenceRefs.length || verifiedClaims.length) ? "verified" : "incomplete",
    expiresAt: clean(product.expiresAt, 80) || null
  };
}

export function inferBuyerState({ conversation = [], explicit = {} } = {}) {
  const turns = (Array.isArray(conversation) ? conversation : []).map(turn => clean(turn?.text || turn?.body || turn, 2500)).filter(Boolean);
  const recent = turns.slice(-8).join("\n");
  const detected = Object.fromEntries(Object.entries(SIGNALS).map(([key, rx]) => [key, rx.test(recent)]));
  const style = explicit.communicationStyle || (detected.rushed ? "concise" : detected.analytical ? "analytical" : detected.frustrated || detected.hesitant ? "supportive" : "balanced");
  const emotion = explicit.emotion || (detected.frustrated ? "frustrated" : detected.confused ? "confused" : detected.skeptical ? "guarded" : detected.interested ? "engaged" : detected.hesitant ? "uncertain" : "neutral");
  const readiness = explicit.readiness || (detected.interested && !detected.hesitant ? "high" : detected.interested || detected.hesitant ? "medium" : "unknown");
  const confidence = turns.length >= 3 ? 0.72 : turns.length ? 0.55 : 0;
  return {
    contract: "georgie.buyer-state.v1",
    emotionalTrack: {
      emotion: observed(emotion, explicit.emotion ? 1 : confidence, turns.slice(-3)),
      trust: observed(explicit.trust || (detected.skeptical ? "low_or_unproven" : "unknown"), explicit.trust ? 1 : confidence, detected.skeptical ? turns.slice(-3) : []),
      perceivedRisk: observed(explicit.perceivedRisk || (detected.hesitant ? "elevated" : "unknown"), explicit.perceivedRisk ? 1 : confidence, detected.hesitant ? turns.slice(-3) : []),
      communicationStyle: observed(style, explicit.communicationStyle ? 1 : confidence, turns.slice(-3))
    },
    decisionTrack: {
      readiness: observed(readiness, explicit.readiness ? 1 : confidence, turns.slice(-3)),
      priceSensitivity: observed(explicit.priceSensitivity || (detected.priceSensitive ? "present" : "unknown"), explicit.priceSensitivity ? 1 : confidence, detected.priceSensitive ? turns.slice(-3) : []),
      authority: observed(explicit.authority || (detected.authorityLimited ? "additional_stakeholder" : "unknown"), explicit.authority ? 1 : confidence, detected.authorityLimited ? turns.slice(-3) : []),
      objection: observed(explicit.objection || "unresolved_or_unknown", explicit.objection ? 1 : 0.35, turns.slice(-1))
    },
    signals: detected,
    inferencePolicy: "Treat inferred psychology as a hypothesis, never a fact. Confirm consequential interpretations with the buyer."
  };
}

function selectClose({ buyer, gaps, fit, product }) {
  if (fit === "poor_fit") return { type: "respectful_disqualification", rationale: "Verified fit is insufficient; protect the buyer and the company from a bad transaction." };
  if (gaps.length) return { type: "discovery", rationale: "Material decision information is still missing." };
  if (buyer.decisionTrack.authority.value === "additional_stakeholder") return { type: "stakeholder_close", rationale: "The next commitment should include the authorized stakeholder." };
  if (buyer.emotionalTrack.trust.value === "low_or_unproven") return { type: "proof_close", rationale: "Resolve trust with verified proof before requesting a commitment." };
  if (buyer.decisionTrack.readiness.value === "high") return { type: "next_step_close", rationale: "Fit and readiness support a clear, freely chosen next step." };
  if (product.packages.length > 1) return { type: "genuine_choice_close", rationale: "Offer verified alternatives without creating a false binary." };
  return { type: "summary_close", rationale: "Confirm understood value and ask whether the logical next step fits." };
}

export function buildUniversalClosingStrategy({ product: rawProduct = {}, conversation = [], buyer: explicitBuyer = {}, deal = {}, verifiedFacts = [], channel = "conversation" } = {}) {
  const product = normalizeProductIntelligence(rawProduct);
  const buyer = inferBuyerState({ conversation, explicit: explicitBuyer });
  const facts = list(verifiedFacts, 50);
  const gaps = [];
  if (product.status !== "verified") gaps.push("verified_product_intelligence");
  if (!explicitBuyer.primaryGoal && !deal.primaryGoal) gaps.push("desired_outcome");
  if (!explicitBuyer.problem && !deal.problem) gaps.push("problem_and_impact");
  if (!explicitBuyer.timeline && !deal.timeline) gaps.push("decision_timing");
  if (!explicitBuyer.authority && buyer.decisionTrack.authority.value === "unknown") gaps.push("decision_authority");
  if (!explicitBuyer.constraints && !deal.constraints) gaps.push("decision_constraints");
  const disqualified = product.disqualifiers.some(rule => clean(deal.disqualificationReason, 500).toLowerCase().includes(rule.toLowerCase()));
  const fit = disqualified ? "poor_fit" : product.status === "verified" ? "potential_fit" : "unverified";
  const close = selectClose({ buyer, gaps, fit, product });
  const nextQuestion = gaps[0] === "verified_product_intelligence"
    ? "I need verified product information before I recommend or promise anything."
    : gaps[0] === "desired_outcome" ? "What outcome would make this decision clearly worthwhile for you?"
    : gaps[0] === "problem_and_impact" ? "What is happening today, and what does leaving it unresolved cost or prevent?"
    : gaps[0] === "decision_timing" ? "What event or deadline actually determines your timing?"
    : gaps[0] === "decision_authority" ? "Who else needs to be comfortable with this decision before the next step?"
    : gaps[0] === "decision_constraints" ? "What constraint could make an otherwise good fit impractical?"
    : "Based on what we have covered, does the proposed next step fit what you are trying to accomplish?";
  return {
    contract: "georgie.universal-master-closer.v1",
    channel: clean(channel, 60) || "conversation",
    product,
    buyer,
    fit,
    verifiedFacts: facts,
    discovery: { completeness: Number(((6 - Math.min(6, gaps.length)) / 6).toFixed(3)), gaps, nextBestQuestion: nextQuestion, selectionBasis: gaps.length ? "highest_material_information_gap" : "commitment_readiness" },
    responsePlan: {
      acknowledge: buyer.emotionalTrack.emotion.value === "neutral" ? "Reflect the buyer's stated goal without inventing emotion." : `Acknowledge the buyer's ${buyer.emotionalTrack.emotion.value} perspective without overstating certainty.`,
      clarify: gaps.length ? nextQuestion : "Confirm that the value, risks, obligations, and next step are mutually understood.",
      value: product.status === "verified" ? "Connect only verified product outcomes and proof to the buyer's stated priorities." : "Do not position the product until its knowledge record is verified.",
      close
    },
    allowedPsychology: ["accurate empathy", "autonomy", "verified social proof", "truthful contrast", "cognitive-load reduction", "uncertainty reduction", "conditional commitment", "evidenced cost of inaction"],
    prohibitedPsychology: ["coercion", "shame", "fear exploitation", "fabricated scarcity", "false urgency", "deceptive anchoring", "hidden pressure", "vulnerability exploitation", "protected-trait targeting", "emotional dependency"],
    execution: {
      externalSendAllowed: product.status === "verified" && fit !== "poor_fit",
      bindingCommitmentAllowed: false,
      humanEscalationRecommended: buyer.emotionalTrack.trust.value === "low_or_unproven" || Boolean(explicitBuyer.requestsHuman),
      reason: product.status !== "verified" ? "product_intelligence_not_verified" : fit === "poor_fit" ? "poor_fit" : "reasoning_ready_nonbinding"
    }
  };
}

export const universalCloserContract = "georgie.universal-master-closer.v1";
