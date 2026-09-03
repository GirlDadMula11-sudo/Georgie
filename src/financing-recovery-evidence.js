import crypto from "node:crypto";
import { validateAttachment } from "./attachments.js";

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
export const EVIDENCE_CONNECTOR_CONTRACT = "georgie.recovery-evidence-connector.v1";
export const PRISM_PRECONTACT_CONTRACT = "georgie.prism-precontact.v1";

export function buildPrismPrecontactPacket(input = {}) {
  const evidenceIds = [...new Set(input.evidenceIds || [])].filter(Boolean);
  const confidence = Number(input.confidence ?? 0);
  const personalized = confidence >= 0.8 && evidenceIds.length > 0;
  return {
    contract: PRISM_PRECONTACT_CONTRACT,
    evidenceVersion: input.evidenceVersion,
    applicantId: input.applicantId,
    dealId: input.dealId,
    facts: {
      businessIdentity: personalized ? clean(input.businessIdentity) || null : null,
      contactIdentity: personalized ? { firstName: clean(input.firstName) || null, email: clean(input.email) || null } : null,
      historicalStatementMonths: (input.documents || []).filter(item => item.verified).map(item => item.statementMonth).filter(Boolean),
      cashFlowSummary: personalized ? input.cashFlowSummary || null : null,
      priorPositions: personalized ? input.priorPositions || [] : [],
      fundingEvidence: personalized ? input.fundingEvidence || [] : [],
      missingRecentMonths: (input.missingMonths || []).slice(0, 2),
      safePersonalizationCues: personalized ? (input.safePersonalizationCues || []).map(value => clean(value, 120)).slice(0, 5) : []
    },
    confidence: personalized ? confidence : 0,
    evidenceIds,
    personalizationMode: personalized ? "verified" : "generic_factual",
    prohibited: ["raw_transactions", "invented_offers", "approval_claims", "rate_claims", "amount_claims"]
  };
}

export async function ingestBulkEvidence(connector, store, { sourceId, authorized = false } = {}) {
  if (connector?.contract !== EVIDENCE_CONNECTOR_CONTRACT || typeof connector.list !== "function" || typeof connector.read !== "function") throw new Error("AUTHORIZED_EVIDENCE_CONNECTOR_REQUIRED");
  if (!authorized || !clean(sourceId)) throw new Error("EVIDENCE_SOURCE_AUTHORIZATION_REQUIRED");
  const results = [];
  for (const descriptor of await connector.list({ sourceId })) {
    const file = await connector.read(descriptor);
    const verified = validateAttachment({ buffer: file.buffer, originalname: file.name, mimetype: file.mimeType });
    const extracted = await connector.extract({ descriptor, contentHash: verified.sha256, buffer: file.buffer });
    const classification = ["application", "bank_statement"].includes(extracted?.type) ? extracted.type : "unknown";
    const match = await connector.match({ extracted, contentHash: verified.sha256 });
    const evidence = { contract: "georgie.recovery-evidence.v1", sourceId, sourceObjectId: clean(descriptor.id), contentHash: verified.sha256, type: classification, statementMonth: extracted?.statementMonth || null, bank: extracted?.bank || null, accountEnding: extracted?.accountEnding || null, businessIdentity: extracted?.businessIdentity || null, evidenceIds: extracted?.evidenceIds || [], confidence: Number(extracted?.confidence || 0) };
    if (classification === "unknown" || match?.canonical !== true || !match.applicantId || match.ambiguous === true) results.push(await store.quarantineEvidence(evidence, "AMBIGUOUS_OR_UNCLASSIFIED"));
    else results.push(await store.persistEvidence({ ...evidence, applicantId: match.applicantId }));
  }
  return results;
}

export function evidenceProcessingKey(contentHash) { return `document-process:${clean(contentHash, 64)}`; }
