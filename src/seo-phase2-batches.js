const SITE = "https://sierramarketinginc.com";

const PROTECTED = Object.freeze([
  "indexed_urls",
  "form_post_endpoints",
  "contact_destinations",
  "testimonials",
  "users",
  "roles",
  "plugins",
  "security",
  "dns",
  "email",
  "lender_systems"
]);

const contracts = Object.freeze({
  homepage_positioning_and_onpage_integrity: Object.freeze({
    pages: ["/"],
    changeClasses: ["title", "meta_description", "primary_h1", "hero_copy", "speed_first_copy"],
    verify: ["public_html", "title", "h1", "protected_surface_invariants"]
  }),
  sitewide_positioning_and_topic_architecture: Object.freeze({
    pages: ["/", "/about-sierra-marketing-inc/", "/sba-loans-for-small-businesses/", "/business-line-of-credit/", "/sba-bank-term-loans-for-business/"],
    changeClasses: ["title", "meta_description", "heading_hierarchy", "positioning_copy", "internal_link_anchor", "breadcrumb_copy", "placeholder_cleanup"],
    verify: ["public_html", "heading_hierarchy", "internal_links", "protected_surface_invariants"]
  }),
  money_page_fact_integrity: Object.freeze({
    pages: ["/sba-loans-for-small-businesses/", "/business-line-of-credit/", "/sba-bank-term-loans-for-business/", "/sba-loan-requirements-2026/", "/sba-loan-vs-line-of-credit/"],
    changeClasses: ["financial_claim_copy", "source_citation", "heading_hierarchy", "product_taxonomy_copy", "stale_rule_cleanup"],
    verify: ["public_html", "factual_predicates", "source_links", "protected_surface_invariants"]
  }),
  trust_conversion_semantics: Object.freeze({
    pages: ["/", "/about-sierra-marketing-inc/", "/contact-us/", "/sba-loans-for-small-businesses/", "/business-line-of-credit/"],
    changeClasses: ["trust_copy", "advisor_role_copy", "form_label_copy", "accessibility_copy", "schema", "internal_link_anchor", "breadcrumb_copy"],
    verify: ["public_html", "structured_data", "form_labels", "protected_surface_invariants"]
  }),
  qualified_conversion_architecture: Object.freeze({
    pages: ["/", "/about-sierra-marketing-inc/", "/contact-us/", "/sba-loans-for-small-businesses/", "/business-line-of-credit/"],
    changeClasses: ["cta_label", "cta_href", "visible_form_label", "navigation_href", "accessibility_copy"],
    verify: ["public_html", "cta_targets", "attribution_preservation", "protected_form_backend_invariants"]
  }),
  high_intent_authority_moat: Object.freeze({
    pages: [],
    changeClasses: ["internal_link_anchor", "hub_spoke_navigation", "metadata", "schema", "existing_page_authority_copy"],
    verify: ["public_html", "internal_links", "structured_data", "protected_surface_invariants"],
    netNewPageCreation: false
  })
});

export const SEO_PHASE2_BATCH_IDS = Object.freeze(Object.keys(contracts));
export const SEO_PHASE2_PROTECTED_SURFACES = PROTECTED;

export const SEO_PHASE2_COMMAND_SEQUENCE = Object.freeze([
  Object.freeze({ commandId: "cmd_sierra_seo_phase2_homepage_positioning_repair_20260825_1327", batch: "homepage_positioning_and_onpage_integrity" }),
  Object.freeze({ commandId: "cmd_sierra_seo_phase2_sitewide_architecture_attack_20260825_1338", batch: "sitewide_positioning_and_topic_architecture" }),
  Object.freeze({ commandId: "cmd_sierra_seo_phase2_money_page_fact_integrity_20260825_1354", batch: "money_page_fact_integrity" }),
  Object.freeze({ commandId: "cmd_sierra_seo_phase2_trust_conversion_semantics_20260825_1349", batch: "trust_conversion_semantics" }),
  Object.freeze({ commandId: "cmd_sierra_seo_phase2_conversion_architecture_20260825_1357", batch: "qualified_conversion_architecture" }),
  Object.freeze({ commandId: "cmd_sierra_seo_phase2_authority_moat_20260825_1342", batch: "high_intent_authority_moat" })
]);

const commandToBatch = new Map(SEO_PHASE2_COMMAND_SEQUENCE.map(item => [item.commandId, item.batch]));

function cleanBatch(value) {
  return String(value || "").trim().toLowerCase();
}

function sameOriginPath(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const url = new URL(value, SITE);
  if (url.origin !== SITE) throw new Error("SEO_PHASE2_EXTERNAL_URL_REJECTED");
  return url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
}

export function compileSeoPhase2Batch(input = {}) {
  const batch = cleanBatch(input.batch || input.program);
  const contract = contracts[batch];
  if (!contract) throw new Error(`SEO_PHASE2_UNKNOWN_BATCH:${batch || "missing"}`);

  const requestedPages = (Array.isArray(input.pages) ? input.pages : []).map(sameOriginPath).filter(Boolean);
  const allowedPages = new Set(contract.pages);
  if (requestedPages.length && !requestedPages.every(page => allowedPages.has(page))) {
    throw new Error("SEO_PHASE2_PAGE_SCOPE_REJECTED");
  }

  if (input.allowFreeform === true || input.freeform === true) throw new Error("SEO_PHASE2_FREEFORM_WRITE_REJECTED");
  if (input.createPages === true && contract.netNewPageCreation === false) throw new Error("SEO_PHASE2_NET_NEW_PAGE_REJECTED");

  return Object.freeze({
    version: 1,
    siteOrigin: SITE,
    batch,
    pages: Object.freeze([...(requestedPages.length ? requestedPages : contract.pages)]),
    changeClasses: Object.freeze([...contract.changeClasses]),
    verification: Object.freeze([...contract.verify]),
    protectedSurfaces: PROTECTED,
    requiresBeforeState: true,
    requiresRollbackMaterial: true,
    requiresSemanticVerification: true,
    duplicateReplayMustBeNoop: true,
    netNewPageCreation: contract.netNewPageCreation !== false
  });
}

export function compilePreservedSeoPhase2Command(input = {}) {
  const commandId = String(input.commandId || "").trim();
  const expectedBatch = commandToBatch.get(commandId);
  if (!expectedBatch) throw new Error(`SEO_PHASE2_UNKNOWN_COMMAND:${commandId || "missing"}`);
  const requestedBatch = cleanBatch(input.batch || input.program || expectedBatch);
  if (requestedBatch !== expectedBatch) throw new Error(`SEO_PHASE2_COMMAND_BATCH_MISMATCH:${commandId}`);
  const index = SEO_PHASE2_COMMAND_SEQUENCE.findIndex(item => item.commandId === commandId);
  const predecessor = index > 0 ? SEO_PHASE2_COMMAND_SEQUENCE[index - 1].commandId : null;
  return Object.freeze({
    commandId,
    sequenceIndex: index,
    predecessorCommandId: predecessor,
    ...compileSeoPhase2Batch({ ...input, batch: expectedBatch })
  });
}
