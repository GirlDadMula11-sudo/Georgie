function referenceFrom(text = "") {
  const explicit = String(text).match(/\b(SCA[-_A-Z0-9]+)\b/i);
  return explicit ? explicit[1] : null;
}

export function deterministicToolPlan(input = "") {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  if (!text) return [];

  const ref = referenceFrom(text);

  if (/\b(sierra|system|crm)\b/.test(lower) && /\b(health|healthy|status|diagnos|failure|failing|broken|stuck)\b/.test(lower)) {
    return [{ tool: "sierra.health", args: {} }];
  }

  if (/\b(sierra|crm|our)\b/.test(lower) && /\b(portfolio|active deals|pipeline|deals)\b/.test(lower) && !ref) {
    return [{ tool: "sierra.portfolio", args: { limit: 25 } }];
  }

  if (/\b(strategy|strategic|priorities|next priorities|what next|next move)\b/.test(lower) && /\b(sierra|company|business|system|technology|tech|crm|capitalmatch)\b/.test(lower)) {
    return [{ tool: "sierra.strategy", args: {} }];
  }

  if (/\b(network|lender network|coverage gap|product gap|lender gap)\b/.test(lower) && /\b(sierra|lender|capital|funding|network)\b/.test(lower)) {
    return [{ tool: "sierra.network_gaps", args: {} }];
  }

  if (ref && /\b(offer|offers|approval|approvals|terms|pricing)\b/.test(lower)) {
    return [{ tool: "sierra.offers", args: { reference: ref } }];
  }

  if (ref && /\b(lender|lenders|submission|response|follow up|follow-up)\b/.test(lower)) {
    return [{ tool: "sierra.lenders", args: { reference: ref } }];
  }

  if (ref && /\b(deal|file|status|underwriting|capitalmatch|application|evidence)\b/.test(lower)) {
    return [{ tool: "sierra.deal", args: { reference: ref } }];
  }

  if (ref && /\b(refresh|recompute|rerun|re-run|re-evaluate|reevaluate)\b/.test(lower)) {
    return [{ tool: "sierra.refresh_pipeline", args: { reference: ref, reason: text.slice(0, 1000) } }];
  }

  return [];
}
