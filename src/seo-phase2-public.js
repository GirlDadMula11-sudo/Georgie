import crypto from "node:crypto";

const SITE = "https://sierramarketinginc.com";
const sha256 = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const clean = value => String(value || "").replace(/\s+/g, " ").trim();

function sameSitePath(pathname) {
  const url = new URL(String(pathname || "/"), SITE);
  if (url.origin !== SITE) throw new Error("SEO_PHASE2_PUBLIC_EXTERNAL_URL_REJECTED");
  return url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
}

function stripHtml(html) {
  return clean(String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;/gi, "’")
    .replace(/&#8220;|&ldquo;|&#8221;|&rdquo;/gi, '"'));
}

function firstTag(html, tag) {
  const match = String(html || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripHtml(match[1]) : null;
}

function metaDescription(html) {
  const text = String(html || "");
  const direct = text.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const reverse = text.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  return clean((direct || reverse || [])[1] || "") || null;
}

function headings(html, level) {
  return [...String(html || "").matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi"))].map(match => stripHtml(match[1])).filter(Boolean);
}

function anchors(html, base) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[2], base);
      links.push({ text: stripHtml(match[4]), href: url.href, pathname: url.origin === SITE ? sameSitePath(url.pathname) : null });
    } catch {}
  }
  return links;
}

export async function readSeoPhase2PublicState({ pages = ["/"], fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("SEO_PHASE2_PUBLIC_FETCH_UNAVAILABLE");
  const output = [];
  for (const rawPath of pages) {
    const pathname = sameSitePath(rawPath);
    const url = new URL(pathname, SITE).href;
    const response = await fetchImpl(url, { redirect: "follow", headers: { "user-agent": "Georgie-SEO-Phase2-Verifier/1.0" }, signal: AbortSignal.timeout(15000) });
    const html = await response.text();
    const text = stripHtml(html);
    const h1 = headings(html, 1);
    const linkRows = anchors(html, url);
    output.push(Object.freeze({
      pathname,
      url,
      status: response.status,
      title: firstTag(html, "title"),
      description: metaDescription(html),
      h1,
      h1Count: h1.length,
      h2Count: headings(html, 2).length,
      structuredDataCount: (html.match(/<script\b[^>]*type=["']application\/ld\+json["']/gi) || []).length,
      internalLinks: linkRows.filter(link => link.pathname).map(link => ({ text: link.text, pathname: link.pathname })),
      bodyTextHash: sha256(text),
      htmlHash: sha256(html),
      textPreview: text.slice(0, 12000)
    }));
  }
  return Object.freeze({ siteOrigin: SITE, observedAt: new Date().toISOString(), pages: Object.freeze(output) });
}

function includesAny(text, values) {
  const lower = String(text || "").toLowerCase();
  return values.filter(value => lower.includes(String(value).toLowerCase()));
}

function pageByPath(state, pathname) {
  const normalized = sameSitePath(pathname);
  return state.pages.find(page => page.pathname === normalized) || null;
}

function addFailure(failures, path, code, evidence = null) {
  failures.push({ path, code, evidence });
}

export async function verifySeoPhase2PublicState({ batch, pages = [], planHash = null, fetchImpl = globalThis.fetch } = {}) {
  const state = await readSeoPhase2PublicState({ pages, fetchImpl });
  const failures = [];
  for (const page of state.pages) {
    if (page.status !== 200) addFailure(failures, page.pathname, "PUBLIC_STATUS_NOT_200", page.status);
  }

  if (batch === "homepage_positioning_and_onpage_integrity") {
    const home = pageByPath(state, "/");
    if (!home) addFailure(failures, "/", "HOMEPAGE_NOT_OBSERVED");
    else {
      for (const phrase of includesAny(home.textPreview, ["Fast Small Business Loans in USA", "Your growth should never wait for slow lenders", "get your capital funded quickly", "startup needing first-time capital"])) addFailure(failures, "/", "SPEED_FIRST_OR_STARTUP_POSITIONING_REMAINS", phrase);
      if (home.h1Count !== 1) addFailure(failures, "/", "HOMEPAGE_H1_COUNT", home.h1Count);
      if (!includesAny(home.textPreview, ["strategic business financing", "financing advisory", "established businesses"]).length) addFailure(failures, "/", "ADVISORY_POSITIONING_NOT_PROVEN");
    }
  } else if (batch === "sitewide_positioning_and_topic_architecture") {
    for (const page of state.pages) {
      for (const phrase of includesAny(page.textPreview, ["NEED TO CHANGE", "Supporting Subheading", "Banks Move Slow. Opportunities Do Not", "Fast Revenue Based Business Funding"])) addFailure(failures, page.pathname, "PLACEHOLDER_OR_SPEED_POSITIONING_REMAINS", phrase);
      if (page.h1Count > 1) addFailure(failures, page.pathname, "MULTIPLE_H1_REMAINS", page.h1Count);
    }
  } else if (batch === "money_page_fact_integrity") {
    const forbidden = [
      "minimum sbss score needed for an sba 7(a) loan is 155",
      "minimum $15000 in monthly revenue",
      "minimum 15000 dollars in consistent monthly revenue",
      "fast merchant cash advance approval",
      "same day business funding",
      "factor rates, holdback percentages",
      "most sba 7a loan programs prefer a personal credit score of 680 or higher",
      "banks want a dscr of 1.25 or higher",
      "the sba approves around 50 to 60 percent"
    ];
    for (const page of state.pages) for (const phrase of includesAny(page.textPreview, forbidden)) addFailure(failures, page.pathname, "UNIVERSAL_OR_STALE_FINANCIAL_CLAIM_REMAINS", phrase);
  } else if (batch === "trust_conversion_semantics") {
    const forbidden = ["Please Wrtie Your Message", "Phone Business Number", "detailed information Type", "access capital quickly and efficiently"];
    for (const page of state.pages) for (const phrase of includesAny(page.textPreview, forbidden)) addFailure(failures, page.pathname, "TRUST_OR_FORM_SEMANTIC_DEFECT_REMAINS", phrase);
  } else if (batch === "qualified_conversion_architecture") {
    const home = pageByPath(state, "/");
    const contact = pageByPath(state, "/contact-us/");
    for (const page of [home, contact].filter(Boolean)) {
      for (const phrase of includesAny(page.textPreview, ["detailed information Type", "Please Wrtie Your Message", "Phone Business Number"])) addFailure(failures, page.pathname, "CONVERSION_LABEL_DEFECT_REMAINS", phrase);
    }
    if (home) {
      const quoteLoops = home.internalLinks.filter(link => /get a quote/i.test(link.text) && link.pathname === "/");
      if (quoteLoops.length) addFailure(failures, "/", "CIRCULAR_GET_A_QUOTE_REMAINS", quoteLoops.length);
    }
  } else if (batch === "high_intent_authority_moat") {
    const marker = "Explore Sierra's Business Financing Guides";
    const marked = state.pages.filter(page => includesAny(page.textPreview, [marker]).length);
    if (!marked.length) addFailure(failures, "sitewide", "AUTHORITY_MOAT_MARKER_NOT_FOUND");
  } else {
    throw new Error(`SEO_PHASE2_PUBLIC_UNKNOWN_BATCH:${String(batch || "missing")}`);
  }

  return Object.freeze({
    verified: failures.length === 0,
    planHash,
    batch,
    observedAt: state.observedAt,
    failures: Object.freeze(failures),
    pages: Object.freeze(state.pages.map(page => ({ pathname: page.pathname, status: page.status, title: page.title, h1: page.h1, h1Count: page.h1Count, structuredDataCount: page.structuredDataCount, htmlHash: page.htmlHash, bodyTextHash: page.bodyTextHash })))
  });
}
