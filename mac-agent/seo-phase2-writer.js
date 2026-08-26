import crypto from "node:crypto";

const SITE = "https://sierramarketinginc.com";
const sha256 = value => crypto.createHash("sha256").update(String(value)).digest("hex");

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

const COMMANDS = Object.freeze({
  cmd_sierra_seo_phase2_homepage_positioning_repair_20260825_1327: Object.freeze({
    batch: "homepage_positioning_and_onpage_integrity",
    sequenceIndex: 0,
    predecessorCommandId: null,
    pages: ["/"],
    changeClasses: ["title", "meta_description", "primary_h1", "hero_copy", "speed_first_copy"],
    verification: ["public_html", "title", "h1", "protected_surface_invariants"],
    netNewPageCreation: true
  }),
  cmd_sierra_seo_phase2_sitewide_architecture_attack_20260825_1338: Object.freeze({
    batch: "sitewide_positioning_and_topic_architecture",
    sequenceIndex: 1,
    predecessorCommandId: "cmd_sierra_seo_phase2_homepage_positioning_repair_20260825_1327",
    pages: ["/", "/about-sierra-marketing-inc/", "/sba-loans-for-small-businesses/", "/business-line-of-credit/", "/sba-bank-term-loans-for-business/"],
    changeClasses: ["title", "meta_description", "heading_hierarchy", "positioning_copy", "internal_link_anchor", "breadcrumb_copy", "placeholder_cleanup"],
    verification: ["public_html", "heading_hierarchy", "internal_links", "protected_surface_invariants"],
    netNewPageCreation: true
  }),
  cmd_sierra_seo_phase2_money_page_fact_integrity_20260825_1354: Object.freeze({
    batch: "money_page_fact_integrity",
    sequenceIndex: 2,
    predecessorCommandId: "cmd_sierra_seo_phase2_sitewide_architecture_attack_20260825_1338",
    pages: ["/sba-loans-for-small-businesses/", "/business-line-of-credit/", "/sba-bank-term-loans-for-business/", "/sba-loan-requirements-2026/", "/sba-loan-vs-line-of-credit/"],
    changeClasses: ["financial_claim_copy", "source_citation", "heading_hierarchy", "product_taxonomy_copy", "stale_rule_cleanup"],
    verification: ["public_html", "factual_predicates", "source_links", "protected_surface_invariants"],
    netNewPageCreation: true
  }),
  cmd_sierra_seo_phase2_trust_conversion_semantics_20260825_1349: Object.freeze({
    batch: "trust_conversion_semantics",
    sequenceIndex: 3,
    predecessorCommandId: "cmd_sierra_seo_phase2_money_page_fact_integrity_20260825_1354",
    pages: ["/", "/about-sierra-marketing-inc/", "/contact-us/", "/sba-loans-for-small-businesses/", "/business-line-of-credit/"],
    changeClasses: ["trust_copy", "advisor_role_copy", "form_label_copy", "accessibility_copy", "schema", "internal_link_anchor", "breadcrumb_copy"],
    verification: ["public_html", "structured_data", "form_labels", "protected_surface_invariants"],
    netNewPageCreation: true
  }),
  cmd_sierra_seo_phase2_conversion_architecture_20260825_1357: Object.freeze({
    batch: "qualified_conversion_architecture",
    sequenceIndex: 4,
    predecessorCommandId: "cmd_sierra_seo_phase2_trust_conversion_semantics_20260825_1349",
    pages: ["/", "/about-sierra-marketing-inc/", "/contact-us/", "/sba-loans-for-small-businesses/", "/business-line-of-credit/"],
    changeClasses: ["cta_label", "cta_href", "visible_form_label", "navigation_href", "accessibility_copy"],
    verification: ["public_html", "cta_targets", "attribution_preservation", "protected_form_backend_invariants"],
    netNewPageCreation: true
  }),
  cmd_sierra_seo_phase2_authority_moat_20260825_1342: Object.freeze({
    batch: "high_intent_authority_moat",
    sequenceIndex: 5,
    predecessorCommandId: "cmd_sierra_seo_phase2_conversion_architecture_20260825_1357",
    pages: [],
    changeClasses: ["internal_link_anchor", "hub_spoke_navigation", "metadata", "schema", "existing_page_authority_copy"],
    verification: ["public_html", "internal_links", "structured_data", "protected_surface_invariants"],
    netNewPageCreation: false
  })
});

function stablePlan(commandId) {
  const contract = COMMANDS[commandId];
  if (!contract) throw new Error(`SEO_PHASE2_MAC_UNKNOWN_COMMAND:${String(commandId || "missing")}`);
  return {
    version: 1,
    commandId,
    sequenceIndex: contract.sequenceIndex,
    predecessorCommandId: contract.predecessorCommandId,
    siteOrigin: SITE,
    batch: contract.batch,
    pages: contract.pages,
    changeClasses: contract.changeClasses,
    verification: contract.verification,
    protectedSurfaces: PROTECTED,
    netNewPageCreation: contract.netNewPageCreation
  };
}

export function localSeoPhase2PlanHash(commandId) {
  return sha256(JSON.stringify(stablePlan(commandId)));
}

export function validateSeoPhase2MacRequest(args = {}) {
  if (args.authority !== "reversible_write" || args.operation !== "execute_phase2_batch") throw new Error("SEO_PHASE2_MAC_AUTHORITY_REJECTED");
  if (String(args.siteOrigin || "").replace(/\/$/, "") !== SITE) throw new Error("SEO_PHASE2_MAC_SITE_REJECTED");
  const plan = stablePlan(String(args.commandId || ""));
  if (String(args.batch || "") !== plan.batch) throw new Error("SEO_PHASE2_MAC_BATCH_MISMATCH");
  if (String(args.planHash || "") !== localSeoPhase2PlanHash(plan.commandId)) throw new Error("SEO_PHASE2_MAC_PLAN_HASH_MISMATCH");
  if (JSON.stringify(args.pages || []) !== JSON.stringify(plan.pages)) throw new Error("SEO_PHASE2_MAC_PAGE_SCOPE_MISMATCH");
  if (JSON.stringify(args.changeClasses || []) !== JSON.stringify(plan.changeClasses)) throw new Error("SEO_PHASE2_MAC_CHANGE_CLASS_MISMATCH");
  if (JSON.stringify(args.protectedSurfaces || []) !== JSON.stringify(PROTECTED)) throw new Error("SEO_PHASE2_MAC_PROTECTED_SURFACE_MISMATCH");
  return Object.freeze({ ...plan, planHash: args.planHash });
}

function replacementsFor(commandId) {
  switch (commandId) {
    case "cmd_sierra_seo_phase2_homepage_positioning_repair_20260825_1327":
      return [{
        path: "/",
        title: "Strategic Business Financing Advisory | Sierra Marketing Inc",
        replacements: [
          ["Fast Small Business Loans in USA", "Strategic Business Financing Advisory for Established Businesses"],
          ["Your growth should never wait for slow lenders.", "Build your financing strategy around fit, readiness, and long-term cash flow."],
          ["With deep roots in merchant cash advance funding and a track record of successful business loan placements, we know how lenders evaluate deals, and how to get your capital funded quickly.", "With years of business-financing experience and a broad lender network, we help owners understand how lenders evaluate a file, strengthen readiness, and choose financing that fits the business."],
          ["Whether you’re a startup needing first-time capital or an established enterprise looking to refinance real estate or secure ongoing working capital, we tailor strategies to your business goals.", "Whether you are an established operating business seeking working capital, refinancing, or commercial real-estate financing, we tailor the strategy to your financial profile and long-term goals."],
          ["Whether you're a startup needing first-time capital or an established enterprise looking to refinance real estate or secure ongoing working capital, we tailor strategies to your business goals.", "Whether you are an established operating business seeking working capital, refinancing, or commercial real-estate financing, we tailor the strategy to your financial profile and long-term goals."]
        ]
      }];
    case "cmd_sierra_seo_phase2_sitewide_architecture_attack_20260825_1338":
      return [
        { path: "/", replacements: [["How To Qualify for SBA Loan Faster", "How to Improve SBA Loan Readiness"]] },
        { path: "/about-sierra-marketing-inc/", replacements: [["fast funding", "well-structured financing"], ["quick funding", "appropriate financing"], ["access capital quickly", "evaluate capital options efficiently"]] },
        { path: "/sba-loans-for-small-businesses/", demoteH1: ["SBA Loans"], replacements: [["Fast Revenue Based Business Funding", "Long-Term Business Financing Guidance"], ["Banks Move Slow. Opportunities Do Not NEED TO CHANGE", "Structured financing starts with fit, documentation, and lender alignment."], ["Banks Move Slow. Opportunities Do Not", "Structured financing starts with fit, documentation, and lender alignment."], ["NEED TO CHANGE", ""]] },
        { path: "/business-line-of-credit/", demoteH1: ["Business Line of Credit"], replacements: [["Banks move slow.", "Traditional credit review can take time."], ["Get fast business funding designed to stabilize cash flow and keep growth on track.", "Use revolving working capital to manage timing gaps while keeping the financing structure aligned with cash flow."]] },
        { path: "/sba-bank-term-loans-for-business/", demoteH1: ["SBA & Bank Term Loans for Businesses"], replacements: [["Supporting Subheading", "Financing Options Built Around Business Needs"], ["Banks Move Slow. Opportunities Do Not", "Structured financing starts with fit, documentation, and lender alignment."]] }
      ];
    case "cmd_sierra_seo_phase2_money_page_fact_integrity_20260825_1354":
      return [
        { path: "/sba-loans-for-small-businesses/", replacements: [
          ["15000 Monthly Revenue With Proven Stability", "Revenue Stability and Repayment Capacity"],
          ["Minimum 15000 dollars in consistent monthly revenue with at least 2 years in business preferred. Stable cash flow and operational history significantly improve SBA loan approval chances.", "Participating lenders evaluate revenue consistency, repayment ability, operating history, and the complete financial profile. Exact thresholds vary by lender and SBA program."],
          ["The SBA loan approval process typically takes 30 to 90 days depending on lender underwriting, documentation readiness, and deal complexity. Proper financial packaging and complete records can significantly reduce delays for SBA loans for small business owners.", "SBA loan timing varies by lender, program, documentation readiness, and deal complexity. Complete records and responsive underwriting support can reduce avoidable delays, but there is no universal approval timeline."],
          ["Most SBA 7a loan programs prefer a personal credit score of 680 or higher. Strong credit improves approval odds and may help secure better SBA loan interest rates for small businesses, though exact requirements vary by lender.", "The SBA does not publish one universal personal credit-score minimum for every 7(a) loan. Participating lenders apply their own credit policies within SBA eligibility and underwriting requirements."],
          ["https://www.fundera.com", "https://www.sba.gov/funding-programs/loans"]
        ] },
        { path: "/business-line-of-credit/", replacements: [
          ["If you are searching for fast merchant cash advance approval, same day business funding, alternative business financing, or working capital for small business, this solution may fit.", "A business line of credit can fit established companies that need reusable working capital and prefer a revolving facility instead of repeated lump-sum financing."],
          ["Minimum $15000 in monthly revenue", "Revenue and qualification requirements vary by lender"],
          ["We clearly explain factor rates, holdback percentages, total payback, and repayment structure before funding.", "We clearly explain the line's interest or fee structure, draw terms, repayment schedule, and lender-specific conditions before you use the facility."],
          ["o qualify, your business must be US based, generate at least $15000 in monthly revenue, maintain consistent bank deposits, and have an active business bank account.", "To qualify, lenders commonly evaluate business location, time in business, revenue consistency, bank activity, credit profile, and repayment capacity. Exact requirements vary by lender."]
        ] },
        { path: "/sba-bank-term-loans-for-business/", replacements: [
          ["If your business generates at least $15000 per month, we can evaluate your approval today.", "We evaluate established businesses for SBA and bank-term financing based on eligibility, repayment capacity, documentation, and lender fit."],
          ["If your business generates at least $15000 per month and meets qualification standards,", "If your business has an established operating history and meets applicable qualification standards,"],
          ["https://en.wikipedia.org", "https://www.sba.gov/funding-programs/loans"]
        ] },
        { path: "/sba-loan-requirements-2026/", replacements: [
          ["To qualify for an SBA loan in 2026, a business needs a credit score of 650 or higher, at least 2 years of operation, USA-based business registration, and proof of ability to repay the loan.", "SBA loan eligibility in 2026 depends on the specific program, SBA requirements, the participating lender's underwriting standards, and the business's ability to repay. There is no single universal personal credit-score or time-in-business threshold for every SBA loan."],
          ["The minimum SBSS score needed for an SBA 7(a) loan is 155 out of 300.", "SBA eliminated the former FICO SBSS scoring requirement for 7(a) Small loan underwriting effective March 1, 2026. Participating lenders still apply their own credit analysis and SBA eligibility rules."],
          ["Banks want a DSCR of 1.25 or higher. This means for every $1 owed, the business earns $1.25.", "Lenders evaluate debt-service coverage under their own credit policies. Exact DSCR expectations vary by lender, loan structure, and the applicable SBA program."],
          ["The SBA approves around 50 to 60 percent of applications that make it to full review.", "Approval outcomes vary materially by lender, program, borrower profile, and documentation quality; Sierra does not present a universal SBA approval rate."],
          ["SBA Loan Requirements 2026: How to Qualify Fast", "SBA Loan Requirements 2026: Eligibility, Documentation and Lender Review"]
        ] },
        { path: "/sba-loan-vs-line-of-credit/", replacements: [
          ["Rate: 8%", "Illustrative pricing: lender-specific"],
          ["Rate: 12–18%", "Illustrative pricing: lender-specific"],
          ["This answers: is SBA loan cheaper than line of credit → yes, in most cases.", "SBA financing is often lower-cost than unsecured revolving credit, but actual cost depends on lender pricing, fees, usage, collateral, and term."],
          ["$150,000 at 8% over 10 years", "A term loan with lender-specific pricing over a longer repayment period"],
          ["$50,000 used repeatedly at 15%", "A revolving line used repeatedly with lender-specific pricing"]
        ] }
      ];
    case "cmd_sierra_seo_phase2_trust_conversion_semantics_20260825_1349":
      return [
        { path: "/", replacements: [["detailed information Type", "Funding Goal"]] },
        { path: "/contact-us/", replacements: [["Phone Business Number", "Business Phone Number"], ["Please Wrtie Your Message", "Please Write Your Message"], ["access capital quickly and efficiently", "evaluate financing options with clear guidance and efficient support"]] },
        { path: "/sba-loans-for-small-businesses/", replacements: [["Why Choose Merchant Cash Advance", "Why Work With Sierra on SBA Preparation"], ["we can evaluate your approval today", "we can evaluate your financing fit and readiness"]] },
        { path: "/business-line-of-credit/", replacements: [["Get fast business funding", "Use flexible working capital"]] }
      ];
    case "cmd_sierra_seo_phase2_conversion_architecture_20260825_1357":
      return [
        { path: "/", replacements: [[">Get A Quote<", ">Start Your Financing Review<"], [">Learn More<", ">Explore Financing Options<"]] },
        { path: "/contact-us/", replacements: [["Please Wrtie Your Message", "Please Write Your Message"], ["Phone Business Number", "Business Phone Number"]] },
        { path: "/sba-loans-for-small-businesses/", replacements: [["Get a Free Quote", "Request an SBA Financing Review"]] },
        { path: "/business-line-of-credit/", replacements: [["Get a Free Quote", "Request a Line of Credit Review"]] }
      ];
    case "cmd_sierra_seo_phase2_authority_moat_20260825_1342": {
      const block = `<section data-georgie-seo-phase2="authority-moat"><h2>Explore Sierra's Business Financing Guides</h2><p>Compare structured financing options and prepare a stronger file before choosing a lender.</p><ul><li><a href="/sba-loans-for-small-businesses/">SBA loan guidance for established businesses</a></li><li><a href="/business-line-of-credit/">Business line of credit for flexible working capital</a></li><li><a href="/sba-bank-term-loans-for-business/">SBA and bank term-loan options</a></li><li><a href="/contact-us/">Speak with Sierra about financing fit</a></li></ul></section>`;
      return [
        { path: "/", appendHtml: block },
        { path: "/sba-loans-for-small-businesses/", appendHtml: block },
        { path: "/business-line-of-credit/", appendHtml: block },
        { path: "/sba-bank-term-loans-for-business/", appendHtml: block }
      ];
    }
    default:
      throw new Error("SEO_PHASE2_MAC_TRANSFORM_NOT_ALLOWLISTED");
  }
}

export function buildSeoPhase2WordpressPageScript(args = {}) {
  const plan = validateSeoPhase2MacRequest(args);
  const targets = replacementsFor(plan.commandId);
  const payload = { commandId: plan.commandId, batch: plan.batch, planHash: plan.planHash, targets };
  return `(() => {
    const payload = ${JSON.stringify(payload)};
    const nonce = window.wpApiSettings && window.wpApiSettings.nonce;
    if (!nonce) throw new Error('WORDPRESS_REST_NONCE_NOT_AVAILABLE');
    function request(method, path, body) {
      const xhr = new XMLHttpRequest();
      xhr.open(method, path, false);
      xhr.setRequestHeader('X-WP-Nonce', nonce);
      if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(body === undefined ? null : JSON.stringify(body));
      if (xhr.status < 200 || xhr.status >= 300) throw new Error('WORDPRESS_REST_' + xhr.status + ':' + path + ':' + String(xhr.responseText || '').slice(0,200));
      return JSON.parse(xhr.responseText || 'null');
    }
    const normalizePath = raw => { try { const p = new URL(String(raw || ''), '${SITE}').pathname; return p.endsWith('/') ? p : p + '/'; } catch { return null; } };
    const escapeRegex = value => String(value).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const replaceLiteral = (raw, from, to) => String(raw || '').replace(new RegExp(escapeRegex(from), 'gi'), to);
    const demoteNamedH1 = (raw, text) => String(raw || '').replace(new RegExp('<h1([^>]*)>\\s*' + escapeRegex(text) + '\\s*<\\/h1>', 'i'), '<h2$1>' + text + '</h2>');
    const collections = ['pages','posts'];
    const rows = [];
    for (const type of collections) {
      let page = 1;
      while (page <= 10) {
        let batchRows;
        try { batchRows = request('GET', '/wp-json/wp/v2/' + type + '?context=edit&per_page=100&page=' + page + '&_fields=id,slug,link,modified_gmt,title,content', undefined); }
        catch (error) { if (String(error.message || error).includes('WORDPRESS_REST_400')) break; throw error; }
        if (!Array.isArray(batchRows) || !batchRows.length) break;
        for (const row of batchRows) rows.push({ ...row, type });
        if (batchRows.length < 100) break;
        page += 1;
      }
    }
    const originals = [], changed = [], missing = [];
    try {
      for (const target of payload.targets) {
        const wanted = normalizePath(target.path);
        const row = rows.find(item => normalizePath(item.link) === wanted);
        if (!row) { missing.push(wanted); continue; }
        const rawContent = String(row.content && row.content.raw || '');
        const rawTitle = String(row.title && row.title.raw || '');
        let nextContent = rawContent, nextTitle = rawTitle;
        for (const pair of target.replacements || []) nextContent = replaceLiteral(nextContent, pair[0], pair[1]);
        for (const heading of target.demoteH1 || []) nextContent = demoteNamedH1(nextContent, heading);
        if (target.appendHtml && !nextContent.includes('data-georgie-seo-phase2="authority-moat"')) nextContent += '\n' + target.appendHtml;
        if (target.title) nextTitle = target.title;
        if (nextContent === rawContent && nextTitle === rawTitle) continue;
        originals.push({ type: row.type, id: row.id, path: wanted, title: rawTitle, content: rawContent, modified_gmt: row.modified_gmt });
        const body = {};
        if (nextContent !== rawContent) body.content = nextContent;
        if (nextTitle !== rawTitle) body.title = nextTitle;
        request('POST', '/wp-json/wp/v2/' + row.type + '/' + row.id, body);
        changed.push({ type: row.type, id: row.id, path: wanted, contentChanged: nextContent !== rawContent, titleChanged: nextTitle !== rawTitle, beforeHash: '${sha256("placeholder")}'.replace('placeholder', rawContent), afterLength: nextContent.length });
      }
      if (missing.length) throw new Error('SEO_PHASE2_WORDPRESS_TARGET_NOT_FOUND:' + missing.join(','));
      if (!changed.length) return { ok: true, verified: false, commandId: payload.commandId, batch: payload.batch, planHash: payload.planHash, changedCount: 0, backupCount: 0, duplicateCandidate: true, reason: 'NO_MATCHING_TRANSFORMATION_REQUIRED_OR_CONTENT_NOT_IN_CORE_REST' };
      for (const original of originals) {
        const current = request('GET', '/wp-json/wp/v2/' + original.type + '/' + original.id + '?context=edit&_fields=id,title,content', undefined);
        const currentContent = String(current.content && current.content.raw || '');
        const currentTitle = String(current.title && current.title.raw || '');
        if (currentContent === original.content && currentTitle === original.title) throw new Error('SEO_PHASE2_WORDPRESS_WRITE_NOT_OBSERVED:' + original.path);
      }
      return { ok: true, verified: true, commandId: payload.commandId, batch: payload.batch, planHash: payload.planHash, changedCount: changed.length, backupCount: originals.length, changed, rollbackPerformed: false };
    } catch (error) {
      const rollbackErrors = [];
      for (const original of originals.reverse()) {
        try { request('POST', '/wp-json/wp/v2/' + original.type + '/' + original.id, { title: original.title, content: original.content }); }
        catch (rollbackError) { rollbackErrors.push(original.path + ':' + String(rollbackError.message || rollbackError)); }
      }
      throw new Error('SEO_PHASE2_WORDPRESS_ROLLED_BACK:' + String(error.message || error) + (rollbackErrors.length ? ':ROLLBACK_ERRORS:' + rollbackErrors.join('|') : ''));
    }
  })()`;
}

export const SEO_PHASE2_MAC_COMMAND_IDS = Object.freeze(Object.keys(COMMANDS));
