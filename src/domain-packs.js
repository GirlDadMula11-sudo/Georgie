const PACKS = Object.freeze({
  universal: { id: "universal", name: "Georgie Core", version: "1.0.0", alwaysOn: true, domains: ["general", "technical", "research", "learning", "creative", "life_admin"], purpose: "Reason, research, plan, communicate, learn preferences, coordinate tools, and verify outcomes across everyday life." },
  personal: { id: "personal", name: "Personal Operating System", version: "1.0.0", domains: ["personal", "family", "household", "travel", "finance"], purpose: "Coordinate personal commitments and household administration under separate consent, data, and approval boundaries." },
  sierra: { id: "sierra", name: "Sierra Operating Intelligence", version: "1.0.0", domains: ["sierra"], purpose: "Provide evidence-backed Sierra, CapitalMatch, lender, deal, infrastructure, and conversion intelligence." }
});
const SIERRA = /\b(sierra|capitalmatch|crm|deal|lender|underwriting|submission|merchant|funding|smartlead)\b/i;
const PERSONAL = /\b(personal|family|daughter|household|home|trip|travel|bill|subscription|purchase|appointment)\b/i;
export function listDomainPacks() { return Object.values(PACKS).map((pack) => ({ ...pack })); }
export function selectDomainPacks(input = "", requestedDomain = "general") { const text = String(input || ""), selected = [PACKS.universal]; if (requestedDomain === "sierra" || SIERRA.test(text)) selected.push(PACKS.sierra); if (requestedDomain === "personal" || PERSONAL.test(text)) selected.push(PACKS.personal); return selected.map(({ id, name, version, purpose }) => ({ id, name, version, purpose })); }
