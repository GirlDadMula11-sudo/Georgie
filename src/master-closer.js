import { buildNegotiationPlan, nextBestNegotiationQuestion, normalizeTransactionType } from "./closing-playbooks.js";
import { buildUniversalClosingStrategy } from "./universal-closer.js";

const CONTRACT = "georgie.master-closer.v3";

const OBJECTION_RULES = [
  ["payment", /payment|daily|weekly|cash flow|too high|afford/i],
  ["amount", /amount|need more|too little|not enough/i],
  ["term", /term|months|weeks|too short|longer/i],
  ["cost", /rate|factor|cost|expensive|interest|too much|price/i],
  ["trust", /trust|legit|scam|comfortable|reputation/i],
  ["timing", /timing|later|next week|not now|wait/i],
  ["competitor_offer", /other offer|competitor|another lender|better offer|alternative/i],
  ["documents", /document|statement|stip|paperwork|bank statement|contract/i],
  ["confusion", /confused|don't understand|explain|what does/i],
  ["think_about_it", /think about|sleep on|consider it/i],
  ["partner", /wife|husband|spouse|partner|co-owner|decision maker/i],
  ["no_response", /no response|ghost|unresponsive|not replying/i],
  ["ready_to_close", /ready|let's do it|move forward|accept|sign|agreed/i]
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
    lender: clean(offer.lender || offer.counterparty, 160),
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

export function chooseNegotiationMove({ objection, bestOffer, merchant = {}, lender = {}, transactionType = "financing" } = {}) {
  const type = objection?.type || "unknown";
  const authority = bestOffer?.concessionAuthority === true;
  const canBind = lender.bindingAuthority === true && authority;
  const moves = {
    payment: "Reframe around cash-flow fit, then seek verified payment relief through term/amount structure.",
    amount: "Anchor on the required economic outcome; seek a better verified package without worsening an unacceptable tradeoff.",
    term: "Trade for duration before conceding on economics; preserve the decision-maker's risk tolerance.",
    cost: "Translate total dollars clearly, compare verified alternatives, and request price relief only within authorized bounds.",
    trust: "Use verified facts, transparent terms, human escalation, and a no-pressure next step.",
    timing: "Identify the actual decision trigger and schedule the next useful action instead of generic chasing.",
    competitor_offer: "Compare verified terms dimension-by-dimension and negotiate against the real BATNA without inventing leverage.",
    documents: "Reduce friction to the smallest verified document or contract step needed for the next state transition.",
    confusion: "Explain the economics or obligations in plain language, confirm understanding, then ask one decision-focused question.",
    think_about_it: "Surface the unresolved variable, give a concise comparison, and secure a specific follow-up point.",
    partner: "Equip the primary contact with a concise decision brief or include the authorized decision-maker.",
    no_response: "Use a bounded no-response ladder with fresh value, then stop before becoming spam.",
    ready_to_close: "Verify final terms, authority, remaining obligations, and any required approval before execution.",
    unknown: "Ask one high-information question to identify the real blocker before conceding anything."
  };
  return {
    move: moves[type] || moves.unknown,
    nextQuestion: nextBestNegotiationQuestion({ objectionType: type, transactionType }),
    bindingActionAllowed: canBind,
    approvalRequired: !canBind,
    guardrails: [
      "Never invent approval, pricing, urgency, counterparty authority, scarcity, or concessions.",
      "Never make a binding commitment without verified authority and applicable approval.",
      "Use only verified alternatives for comparative leverage.",
      "Preserve a clear human-escalation option in external communications."
    ],
    merchantGoal: clean(merchant.primaryGoal, 300) || null
  };
}

export function buildClosingBrief({ reference, transactionType = "financing", merchant = {}, prospect = {}, product = {}, offers = [], conversation = [], lender = {}, verifiedFacts = [], constraints = {}, channel = "conversation", now = new Date().toISOString() } = {}) {
  const normalizedType = normalizeTransactionType(transactionType);
  const normalized = offers.map(normalizeVerifiedOffer);
  const ranked = normalized
    .map((offer, i) => ({ offer, score: scoreVerifiedOffer({ ...offers[i], ...offer }, merchant) }))
    .filter(x => x.score.eligible)
    .sort((a, b) => b.score.score - a.score.score);
  const lastText = conversation.map(x => clean(x?.text || x?.body, 2000)).filter(Boolean).at(-1) || "";
  const objection = classifyClosingObjection(lastText);
  const bestOffer = ranked[0]?.offer || null;
  const next = chooseNegotiationMove({ objection, bestOffer, merchant, lender, transactionType: normalizedType });
  const negotiationPlan = buildNegotiationPlan({
    transactionType: normalizedType,
    goals: merchant.goals || { primaryGoal: merchant.primaryGoal || null },
    counterparty: { role: lender.role || lender.name || null, knownPriorities: lender.knownPriorities || [], authorityVerified: lender.authorityVerified === true },
    verifiedFacts,
    constraints: { ...constraints, ourBindingAuthorityVerified: lender.bindingAuthority === true },
    objection
  });
  const universalStrategy = buildUniversalClosingStrategy({
    product,
    conversation,
    buyer: prospect,
    deal: { primaryGoal: merchant.primaryGoal, constraints },
    verifiedFacts,
    channel
  });
  const verifiedOfferCount = normalized.filter(x => x.verified).length;
  const readinessChecks = {
    dealIdentity: Boolean(clean(reference, 160)),
    evidenceBacked: verifiedOfferCount > 0 || negotiationPlan.evidenceState === "evidence_backed",
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
    transactionType: normalizedType,
    observedAt: now,
    state: readinessChecks.evidenceBacked ? "closing_brief_ready" : "evidence_or_discovery_required",
    merchant: {
      primaryGoal: clean(merchant.primaryGoal, 300) || null,
      priorities: normalizedPriorities(merchant.priorities),
      batna: clean(merchant.batna, 500) || null
    },
    objection,
    verifiedOfferCount,
    rankedOffers: ranked.map(({ offer, score }) => ({ ...offer, score: score.score, dimensions: score.dimensions })),
    bestOffer,
    negotiationPlan,
    universalStrategy,
    nextBestAction: next,
    concessionFrontier: {
      canNegotiateWithinVerifiedAuthority: Boolean(bestOffer?.concessionAuthority),
      bindingCommitmentRequiresApproval: !next.bindingActionAllowed
    },
    executionQuality: {
      target: 0.99,
      measured: Number(executionQuality.toFixed(4)),
      checks: readinessChecks,
      note: "99% is an execution-quality target, not a promised transaction-close rate. Actual success rates must be measured from verified outcomes by transaction type."
    },
    prohibited: ["fabricated urgency", "fabricated approval", "fabricated authority", "unverified terms", "unauthorized binding commitment", "synthetic outcome learning"]
  };
}

export function closingOutcomeLearningRecord({ brief, outcome = {}, evidenceRefs = [] } = {}) {
  if (!brief?.reference) throw new Error("Closing brief is required");
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) throw new Error("Verified outcome evidence is required");
  if (!['funded','won','closed','lost','declined','withdrawn','renewed','collected'].includes(String(outcome.status || '').toLowerCase())) throw new Error("Outcome must be a verified terminal status");
  return {
    contract: "georgie.master-closer-learning.v1",
    reference: brief.reference,
    transactionType: brief.transactionType || "general",
    status: String(outcome.status).toLowerCase(),
    counterparty: clean(outcome.lender || outcome.counterparty, 160) || null,
    objectionType: brief.objection?.type || "unknown",
    selectedOfferId: clean(outcome.offerId, 160) || brief.bestOffer?.offerId || null,
    evidenceRefs: evidenceRefs.map(v => clean(v, 300)),
    synthetic: false,
    observedAt: clean(outcome.observedAt, 80) || new Date().toISOString()
  };
}

export const masterCloserContract = CONTRACT;
const DISCLOSURE = "If you would prefer to speak directly with a human, I can connect you with CEO Jason Sierra or Louri Brown.";
const VERIFIED = new Set(["verified", "authoritative"]);

const boundaryClean = (value, max = 5000) => String(value || "").trim().slice(0, max);
const disclosureLike = (line) => /Jason Sierra/i.test(line) && /Louri Brown/i.test(line) && /(?:human|speak|contact|connect|direct)/i.test(line);

export function enforceHumanAccessText(input = "") {
  const lines = String(input).replace(/\r\n/g, "\n").split("\n").filter((line) => !disclosureLike(line));
  let signature = lines.findIndex((line) => /^\s*(?:--\s*)?(?:Georgie|Best,|Best regards,|Regards,|Sincerely,)\s*$/i.test(line));
  if (signature < 0) { lines.push("Georgie", "Sierra Capital Advisory"); signature = lines.length - 2; }
  while (signature > 0 && !lines[signature - 1].trim()) { lines.splice(signature - 1, 1); signature -= 1; }
  lines.splice(signature, 0, "", DISCLOSURE, "");
  return lines.join("\n").trim();
}

export function enforceHumanAccessHtml(input = "") {
  let html = String(input || "");
  html = html.replace(/<(?:p|div)[^>]*>[\s\S]*?Jason Sierra[\s\S]*?Louri Brown[\s\S]*?<\/(?:p|div)>/gi, "");
  const disclosure = `<p data-georgie-human-access="v1">${DISCLOSURE}</p>`;
  const signature = /(<(?:p|div)[^>]*>\s*(?:--\s*)?(?:Georgie|Best,|Best regards,|Regards,|Sincerely,)[\s\S]*$)/i;
  if (signature.test(html)) return html.replace(signature, `${disclosure}$1`);
  return `${html}${disclosure}<p>Georgie<br>Sierra Capital Advisory</p>`;
}

export function prepareOutboundCorrespondence(message = {}) {
  if (!boundaryClean(message.idempotencyKey, 200)) throw new Error("OUTBOUND_IDEMPOTENCY_KEY_REQUIRED");
  if (!boundaryClean(message.rationale, 2000)) throw new Error("OUTBOUND_RATIONALE_REQUIRED");
  if (!message.evidenceState || typeof message.evidenceState !== "object") throw new Error("OUTBOUND_EVIDENCE_STATE_REQUIRED");
  const claims = Array.isArray(message.evidenceState.claims) ? message.evidenceState.claims : [];
  const sensitive = new Set(["approval", "term", "lender_position", "deadline", "document", "authority", "commitment"]);
  if (claims.some((claim) => sensitive.has(claim?.type) && !VERIFIED.has(claim?.status))) throw new Error("UNVERIFIED_AUTHORITY_SENSITIVE_CLAIM");
  if (message.escalation?.required === true && message.escalation?.approved !== true) throw new Error("HUMAN_ESCALATION_REQUIRED");
  return { ...message, text: message.text == null ? undefined : enforceHumanAccessText(message.text), html: message.html == null ? undefined : enforceHumanAccessHtml(message.html) };
}

export function selectNextBestAction({ audience, deal = {}, evidence = [], requestedNegotiation = null } = {}) {
  const authoritative = evidence.filter((item) => VERIFIED.has(item?.status) && item?.source && item?.observedAt);
  const stale = authoritative.some((item) => item.expiresAt && Date.parse(item.expiresAt) <= Date.now());
  const contradictory = authoritative.some((item) => item.contradicted === true);
  if (!authoritative.length || stale || contradictory) return { action: "human_escalation", target: "Jason Sierra or Louri Brown", reason: !authoritative.length ? "missing_authoritative_evidence" : stale ? "stale_evidence" : "contradictory_evidence", sendAllowed: false };
  if (requestedNegotiation && (!requestedNegotiation.authority || requestedNegotiation.withinAuthority !== true)) return { action: "human_escalation", target: "Jason Sierra or Louri Brown", reason: "authority_sensitive_negotiation", sendAllowed: false };
  const missing = Array.isArray(deal.stipulations) ? deal.stipulations.filter((item) => item.status !== "satisfied") : [];
  if (missing.length) return { action: "resolve_stipulation", audience: boundaryClean(audience, 40), outcome: `obtain:${boundaryClean(missing[0].id || missing[0].name, 120)}`, evidenceIds: authoritative.map((item) => item.id).filter(Boolean), sendAllowed: true };
  if (deal.offer?.status === "verified" && deal.offer?.accepted !== true) return { action: "clarify_verified_offer", outcome: "verified_acceptance_or_specific_objection", evidenceIds: authoritative.map((item) => item.id).filter(Boolean), sendAllowed: true };
  if (deal.accepted === true && deal.funding?.status !== "funded") return { action: "progress_funding", outcome: "next_verified_funding_milestone", evidenceIds: authoritative.map((item) => item.id).filter(Boolean), sendAllowed: true };
  return { action: "request_next_measurable_commitment", outcome: "dated_recipient_commitment", evidenceIds: authoritative.map((item) => item.id).filter(Boolean), sendAllowed: true };
}

export function createOutboundBoundary({ deliver, audit, lookup = async () => null }) {
  if (typeof deliver !== "function" || typeof audit !== "function") throw new Error("Outbound boundary dependencies are required");
  const inFlight = new Map(), completed = new Map();
  return async function send(message) {
    const prepared = prepareOutboundCorrespondence(message); const key = boundaryClean(prepared.idempotencyKey, 200);
    if (completed.has(key)) return { ...completed.get(key), deduplicated: true };
    if (inFlight.has(key)) return inFlight.get(key);
    const work = (async () => {
      const base = { idempotencyKey: key, correlationId: boundaryClean(prepared.correlationId || key, 200), dealId: boundaryClean(prepared.dealId, 200) || null, threadId: boundaryClean(prepared.threadId, 200) || null, audience: boundaryClean(prepared.audience, 40) || "unknown", rationale: prepared.rationale, evidenceState: prepared.evidenceState, escalation: prepared.escalation || null };
      const prior = await lookup(key);
      if (prior?.status === "sent") { const result = { provider: prior.provider, idempotencyKey: key, deduplicated: true }; completed.set(key, result); return result; }
      if (prior) throw new Error("OUTBOUND_DELIVERY_STATE_UNCERTAIN");
      await audit({ ...base, status: "attempted", at: new Date().toISOString() });
      try { const provider = await deliver(prepared); const result = { provider, idempotencyKey: key, deduplicated: false }; completed.set(key, result); await audit({ ...base, status: "sent", provider, at: new Date().toISOString() }); return result; }
      catch (error) { await audit({ ...base, status: "failed", error: boundaryClean(error?.message || error, 500), at: new Date().toISOString() }); throw error; }
      finally { inFlight.delete(key); }
    })();
    inFlight.set(key, work); return work;
  };
}

export { DISCLOSURE as HUMAN_ACCESS_DISCLOSURE };
