const CONTRACT = "georgie.master-closer.v2";

const OBJECTION_RULES = [
  ["payment", /payment|daily|weekly|cash flow|too high|afford/i],
  ["amount", /amount|need more|too little|not enough/i],
  ["term", /term|months|weeks|too short|longer/i],
  ["cost", /rate|factor|cost|expensive|interest|too much/i],
  ["trust", /trust|legit|scam|comfortable|reputation/i],
  ["timing", /timing|later|next week|not now|wait/i],
  ["competitor_offer", /other offer|competitor|another lender|better offer/i],
  ["documents", /document|statement|stip|paperwork|bank statement/i],
  ["confusion", /confused|don't understand|explain|what does/i],
  ["think_about_it", /think about|sleep on|consider it/i],
  ["partner", /wife|husband|spouse|partner|co-owner/i],
  ["no_response", /no response|ghost|unresponsive|not replying/i],
  ["ready_to_close", /ready|let's do it|move forward|accept|sign/i]
];

const PRIORITY_DEFAULTS = { amount: 0.28, payment: 0.24, term: 0.18, cost: 0.18, speed: 0.12 };
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, Number(n) || 0));
const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max);

export function classifyClosingObjection(text = "") {
  const input = clean(text, 5000);
  for (const [type, rx] of OBJECTION_RULES) if (rx.test(input)) return { type, confidence: 0.9, evidence: input };
  return { type: "unknown", confidence: input ? 0.35 : 0, evidence: input };
}

export function normalizeVerifiedOffer(offer = {}) {
  const evidence = Array.isArray(offer.evidenceRefs) ? offer.evidenceRefs.filter(Boolean) : [];
  const verified = offer.verified === true && evidence.length > 0;
  return {
    offerId: clean(offer.offerId || offer.id, 160),
    lender: clean(offer.lender, 160),
    verified,
    evidenceRefs: evidence,
    amount: Number(offer.amount) || null,
    termMonths: Number(offer.termMonths) || null,
    payment: Number(offer.payment) || null,
    paymentFrequency: clean(offer.paymentFrequency, 40) || null,
    factorRate: Number(offer.factorRate) || null,
    apr: Number(offer.apr) || null,
    totalPayback: Number(offer.totalPayback) || null,
    fees: Number(offer.fees) || null,
    netProceeds: Number(offer.netProceeds) || null,
    prepay: offer.prepay ?? null,
    renewal: offer.renewal ?? null,
    expiration: clean(offer.expiration, 80) || null,
    stipulations: Array.isArray(offer.stipulations) ? offer.stipulations.map(v => clean(v, 300)) : [],
    concessionAuthority: offer.concessionAuthority === true && verified
  };
}

function normalizedPriorities(priorities = {}) {
  const merged = { ...PRIORITY_DEFAULTS, ...priorities };
  const total = Object.values(merged).reduce((s, n) => s + Math.max(0, Number(n) || 0), 0) || 1;
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, Math.max(0, Number(v) || 0) / total]));
}

export function scoreVerifiedOffer(offer, merchant = {}) {
  const o = normalizeVerifiedOffer(offer);
  if (!o.verified) return { offerId: o.offerId, eligible: false, score: 0, reasons: ["Offer is not backed by verified evidence"] };
  const p = normalizedPriorities(merchant.priorities);
  const target = merchant.targets || {};
  const amount = o.amount && target.amount ? clamp(o.amount / target.amount) : o.amount ? 0.7 : 0;
  const payment = o.payment && target.maxPayment ? clamp(target.maxPayment / o.payment) : o.payment ? 0.6 : 0;
  const term = o.termMonths && target.minTermMonths ? clamp(o.termMonths / target.minTermMonths) : o.termMonths ? 0.6 : 0;
  const costMetric = o.totalPayback && o.amount ? clamp(1 - Math.max(0, (o.totalPayback - o.amount) / o.amount) / 1.5) : o.factorRate ? clamp(1 - Math.max(0, o.factorRate - 1) / 1.5) : 0.5;
  const speed = offer.readyToFund === true ? 1 : offer.fastClose === true ? 0.8 : 0.5;
  const score = amount * p.amount + payment * p.payment + term * p.term + costMetric * p.cost + speed * p.speed;
  return { offerId: o.offerId, lender: o.lender, eligible: true, score: Number(score.toFixed(4)), dimensions: { amount, payment, term, cost: costMetric, speed } };
}

export function chooseNegotiationMove({ objection, bestOffer, merchant = {}, lender = {} } = {}) {
  const type = objection?.type || "unknown";
  const authority = bestOffer?.concessionAuthority === true;
  const canBind = lender.bindingAuthority === true && authority;
  const moves = {
    payment: "Reframe around cash-flow fit, then seek verified payment relief through term/amount structure.",
    amount: "Anchor on use-of-funds and required net proceeds; seek a higher verified amount without worsening unacceptable payment burden.",
    term: "Trade for duration before conceding on economics; preserve merchant payment tolerance.",
    cost: "Translate total dollars clearly, compare verified alternatives, and request price relief only within lender-authorized bounds.",
    trust: "Use verified facts, transparent terms, named human escalation, and no-pressure next step.",
    timing: "Identify the actual decision trigger and schedule the next useful action instead of generic chasing.",
    competitor_offer: "Compare verified terms dimension-by-dimension and negotiate against the merchant's real BATNA without inventing leverage.",
    documents: "Reduce friction to the smallest verified document/stipulation needed for the next state transition.",
    confusion: "Explain the economics in plain language, confirm understanding, then ask one decision-focused question.",
    think_about_it: "Surface the unresolved variable, give a concise comparison, and secure a specific follow-up point.",
    partner: "Equip the merchant with a concise decision brief or include the authorized decision-maker.",
    no_response: "Use a bounded no-response ladder with fresh value, then stop before becoming spam.",
    ready_to_close: "Verify final terms, acceptance authority, required stips, and human/binding approval before execution.",
    unknown: "Ask one high-information question to identify the real blocker before conceding anything."
  };
  return {
    move: moves[type] || moves.unknown,
    bindingActionAllowed: canBind,
    approvalRequired: !canBind,
    guardrails: [
      "Never invent approval, pricing, urgency, lender authority, or concessions.",
      "Never accept or bind financing terms without verified authority and applicable approval.",
      "Use only verified offers for comparative leverage.",
      "Preserve a clear human-escalation option in external communications."
    ],
    merchantGoal: clean(merchant.primaryGoal, 300) || null
  };
}

export function buildClosingBrief({ reference, merchant = {}, offers = [], conversation = [], lender = {}, now = new Date().toISOString() } = {}) {
  const normalized = offers.map(normalizeVerifiedOffer);
  const ranked = normalized
    .map((offer, i) => ({ offer, score: scoreVerifiedOffer({ ...offers[i], ...offer }, merchant) }))
    .filter(x => x.score.eligible)
    .sort((a, b) => b.score.score - a.score.score);
  const lastText = conversation.map(x => clean(x?.text || x?.body, 2000)).filter(Boolean).at(-1) || "";
  const objection = classifyClosingObjection(lastText);
  const bestOffer = ranked[0]?.offer || null;
  const next = chooseNegotiationMove({ objection, bestOffer, merchant, lender });
  const verifiedOfferCount = normalized.filter(x => x.verified).length;
  const readinessChecks = {
    dealIdentity: Boolean(clean(reference, 160)),
    verifiedOffer: verifiedOfferCount > 0,
    objectionKnown: objection.type !== "unknown" || !lastText,
    nextAction: Boolean(next.move),
    noFabricationGuard: true,
    bindingGuard: true,
    evidenceLineage: normalized.filter(x => x.verified).every(x => x.evidenceRefs.length > 0)
  };
  const passed = Object.values(readinessChecks).filter(Boolean).length;
  const executionQuality = passed / Object.keys(readinessChecks).length;
  return {
    contract: CONTRACT,
    reference: clean(reference, 160),
    observedAt: now,
    state: bestOffer ? "closing_brief_ready" : "offer_verification_required",
    merchant: {
      primaryGoal: clean(merchant.primaryGoal, 300) || null,
      priorities: normalizedPriorities(merchant.priorities),
      batna: clean(merchant.batna, 500) || null
    },
    objection,
    verifiedOfferCount,
    rankedOffers: ranked.map(({ offer, score }) => ({ ...offer, score: score.score, dimensions: score.dimensions })),
    bestOffer,
    nextBestAction: next,
    concessionFrontier: {
      canNegotiateWithinVerifiedAuthority: Boolean(bestOffer?.concessionAuthority),
      bindingCommitmentRequiresApproval: !next.bindingActionAllowed
    },
    executionQuality: {
      target: 0.99,
      measured: Number(executionQuality.toFixed(4)),
      checks: readinessChecks,
      note: "99% is an execution-quality target, not a promised funded-close rate. Close-rate performance must be measured from verified outcomes."
    },
    prohibited: ["fabricated urgency", "fabricated approval", "fabricated lender authority", "unverified terms", "unauthorized binding commitment", "synthetic outcome learning"]
  };
}

export function closingOutcomeLearningRecord({ brief, outcome = {}, evidenceRefs = [] } = {}) {
  if (!brief?.reference) throw new Error("Closing brief is required");
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) throw new Error("Verified outcome evidence is required");
  if (!['funded','lost','declined','withdrawn'].includes(String(outcome.status || '').toLowerCase())) throw new Error("Outcome must be a verified terminal status");
  return {
    contract: "georgie.master-closer-learning.v1",
    reference: brief.reference,
    status: String(outcome.status).toLowerCase(),
    lender: clean(outcome.lender, 160) || null,
    objectionType: brief.objection?.type || "unknown",
    selectedOfferId: clean(outcome.offerId, 160) || brief.bestOffer?.offerId || null,
    evidenceRefs: evidenceRefs.map(v => clean(v, 300)),
    synthetic: false,
    observedAt: clean(outcome.observedAt, 80) || new Date().toISOString()
  };
}

export const masterCloserContract = CONTRACT;
