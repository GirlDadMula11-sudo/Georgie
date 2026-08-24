const PLAYBOOKS = {
  financing: {
    objectives: ["amount", "payment", "term", "cost", "speed", "certainty"],
    discovery: ["What matters most: amount, payment, term, speed, or total cost?", "What would make this an easy yes today?"],
    leverage: ["verified competing offers", "verified lender flexibility", "document completeness", "timing certainty"],
    close: "Confirm verified final economics, remaining stipulations, decision authority, and the exact next binding step."
  },
  sales: {
    objectives: ["fit", "price", "scope", "timing", "risk", "implementation"],
    discovery: ["What outcome has to improve for this purchase to be worthwhile?", "What is the cost of leaving the problem unsolved?"],
    leverage: ["verified ROI", "scope alternatives", "implementation certainty", "credible proof"],
    close: "Summarize agreed value, remove the last material risk, and ask for the smallest clear commitment that advances the sale."
  },
  procurement: {
    objectives: ["price", "quality", "service", "terms", "delivery", "risk"],
    discovery: ["Which requirement is non-negotiable and which is tradable?", "What would make this the preferred commercial package?"],
    leverage: ["volume", "term length", "payment timing", "service scope", "verified alternatives"],
    close: "Package concessions conditionally, confirm deliverables and service levels, and document the agreed commercial package."
  },
  vendor: {
    objectives: ["price", "service", "terms", "delivery", "continuity"],
    discovery: ["Where do you have flexibility if we improve certainty or commitment?", "Which term is easiest for you to move?"],
    leverage: ["renewal", "volume", "faster payment", "scope", "credible alternatives"],
    close: "Trade rather than give: every concession should buy a reciprocal improvement in price, service, timing, or certainty."
  },
  renewal: {
    objectives: ["retention", "price", "scope", "term", "service", "risk"],
    discovery: ["What has to change for renewal to feel clearly worthwhile?", "What issue would make you leave if it stays unresolved?"],
    leverage: ["continuity", "switching cost", "usage evidence", "service improvements", "term commitment"],
    close: "Resolve the renewal blocker, condition any concession on commitment, and make the renewal path frictionless."
  },
  collections: {
    objectives: ["recovery", "timing", "certainty", "relationship", "compliance"],
    discovery: ["What can be paid reliably and when?", "What is preventing payment under the current arrangement?"],
    leverage: ["structured payment options", "verified obligation", "timing flexibility", "relationship preservation"],
    close: "Secure a specific lawful payment commitment with date, amount, method, and documented follow-through; never threaten or misrepresent consequences."
  },
  partnership: {
    objectives: ["economics", "control", "scope", "risk", "term", "exit"],
    discovery: ["What must be true for both sides to call this partnership successful?", "Which risks are you unwilling to carry?"],
    leverage: ["distribution", "capability", "capital", "customer access", "exclusive value", "credible alternatives"],
    close: "Align economics and responsibilities, surface hidden asymmetries, and confirm governance and exit mechanics before commitment."
  },
  general: {
    objectives: ["value", "price", "timing", "risk", "certainty"],
    discovery: ["What matters most in this decision?", "What is the real blocker to moving forward?"],
    leverage: ["verified alternatives", "timing", "scope", "certainty", "reciprocal concessions"],
    close: "Summarize the verified deal, resolve the last material objection, and ask for a clear next commitment."
  }
};

const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max);

export function normalizeTransactionType(value = "general") {
  const type = clean(value, 80).toLowerCase().replace(/[^a-z_]/g, "_");
  return PLAYBOOKS[type] ? type : "general";
}

export function transactionPlaybook(type = "general") {
  const normalized = normalizeTransactionType(type);
  return { type: normalized, ...PLAYBOOKS[normalized] };
}

export function buildNegotiationPlan({ transactionType = "general", goals = {}, counterparty = {}, verifiedFacts = [], constraints = {}, objection = null } = {}) {
  const playbook = transactionPlaybook(transactionType);
  const facts = Array.isArray(verifiedFacts) ? verifiedFacts.filter(Boolean).map(v => clean(v, 500)) : [];
  const hardConstraints = Object.entries(constraints || {}).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}:${clean(v, 200)}`);
  const noVerifiedLeverage = facts.length === 0;
  return {
    contract: "georgie.negotiation-plan.v1",
    transactionType: playbook.type,
    objectives: playbook.objectives,
    statedGoals: goals,
    counterparty: {
      role: clean(counterparty.role, 120) || null,
      knownPriorities: counterparty.knownPriorities || [],
      authorityVerified: counterparty.authorityVerified === true
    },
    discoveryQuestions: playbook.discovery,
    leverageSources: noVerifiedLeverage ? [] : playbook.leverage,
    constraints: hardConstraints,
    objection: objection || null,
    tactics: [
      "Lead with diagnosis before persuasion.",
      "Anchor only on defensible verified value or economics.",
      "Use conditional concessions: if we give X, obtain Y.",
      "Prefer multiple equivalent options over a single take-it-or-leave-it demand.",
      "Separate positions from underlying interests.",
      "Use silence and calibrated questions without deception.",
      "Do not create false urgency, fake scarcity, fake authority, or imaginary competing offers.",
      "Stop conceding when the trade no longer improves expected value or violates a hard constraint."
    ],
    closePattern: playbook.close,
    authority: {
      bindingCommitmentAllowed: counterparty.authorityVerified === true && constraints.ourBindingAuthorityVerified === true,
      otherwiseApprovalRequired: !(counterparty.authorityVerified === true && constraints.ourBindingAuthorityVerified === true)
    },
    evidenceState: noVerifiedLeverage ? "discovery_required" : "evidence_backed"
  };
}

export function buildConcessionLadder({ items = [], floor = {}, authorityVerified = false } = {}) {
  const safeItems = (Array.isArray(items) ? items : []).map((item, index) => ({
    rank: index + 1,
    give: clean(item.give, 300),
    get: clean(item.get, 300),
    verified: item.verified === true,
    reversible: item.reversible !== false
  })).filter(item => item.give && item.get);
  return {
    contract: "georgie.concession-ladder.v1",
    authorityVerified: authorityVerified === true,
    floor,
    ladder: safeItems,
    rule: "Never concede unconditionally; pair each concession with a reciprocal gain and never cross a verified floor without explicit approval.",
    canExecuteBindingConcession: authorityVerified === true
  };
}

export function nextBestNegotiationQuestion({ objectionType = "unknown", transactionType = "general" } = {}) {
  const questions = {
    payment: "If the payment fit your cash flow, is there anything else stopping you from moving forward?",
    cost: "Is your concern the total dollars, the rate itself, or whether the value justifies the cost?",
    amount: "What minimum amount makes the transaction worth doing?",
    term: "What term would make the payment or risk acceptable?",
    trust: "What specific proof or transparency would make you comfortable deciding?",
    timing: "What event or condition determines when you can move forward?",
    competitor_offer: "Which exact verified term in the other offer is better for you?",
    documents: "What is the smallest document step you can complete right now?",
    confusion: "Which part of the economics or process is unclear?",
    think_about_it: "What specifically do you still need to think through?",
    partner: "What does the other decision-maker need to see to be comfortable?",
    no_response: "Would it be more useful if I close this out, or is there one unresolved issue I can fix?",
    ready_to_close: "Before we finalize, do the verified terms match what you intend to accept?",
    unknown: transactionPlaybook(transactionType).discovery[1]
  };
  return questions[objectionType] || questions.unknown;
}
