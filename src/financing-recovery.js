import crypto from "node:crypto";
import { sendClientMessageAndVerify } from "./client-correspondence.js";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SUPPRESSION_REASONS = new Set(["opt_out", "complaint", "invalid", "bounce", "dispute", "duplicate", "active_deal", "recent_contact"]);
export const RECOVERY_POLICY = Object.freeze({
  contract: "georgie.financing-recovery.v2",
  maxAttempts: 3,
  minContactDays: 7,
  models: { default: "luna", escalation: "terra", complex: "sol", pairs: false }
});
export const PRISM_ADAPTER_CONTRACT = "georgie.prism-handoff.v1";
const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const digest = value => crypto.createHash("sha256").update(String(value)).digest("hex");

export function canonicalEmail(value) {
  const email = clean(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("VALID_EMAIL_REQUIRED");
  return email;
}

export function recoveryIdentity({ tenantId = "sierra", sourceApplicationId, email }) {
  if (!clean(sourceApplicationId)) throw new Error("STABLE_SOURCE_APPLICATION_ID_REQUIRED");
  const normalizedEmail = canonicalEmail(email);
  return {
    applicantId: `app_${digest(`${tenantId}:${normalizedEmail}`).slice(0, 24)}`,
    dealId: `deal_${digest(`${tenantId}:${sourceApplicationId}`).slice(0, 24)}`,
    threadId: `thread_${digest(`${tenantId}:${sourceApplicationId}:${normalizedEmail}`).slice(0, 24)}`
  };
}

export function requiredStatementMonths({ asOf = new Date(), jurisdiction, lane = "new", authoritativeMissingMonths = null, documents = [] }) {
  if (lane === "new") {
    if (!Array.isArray(authoritativeMissingMonths)) throw new Error("AUTHORITATIVE_PRODUCT_STATEMENT_REQUIREMENTS_REQUIRED");
    const months = [...new Set(authoritativeMissingMonths.map(value => clean(value)).filter(value => MONTH.test(value)))];
    if (months.length !== authoritativeMissingMonths.length) throw new Error("INVALID_AUTHORITATIVE_STATEMENT_MONTH");
    return months;
  }
  const verified = new Set(documents.filter(document => document.verified === true).map(document => document.statementMonth));
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const missing = [];
  for (let offset = 1; missing.length < 2 && offset <= 120; offset += 1) {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - offset, 1)).toISOString().slice(0, 7);
    if (!verified.has(month)) missing.push(month);
  }
  return missing;
}

export function missingStatementMonths(required, documents = [], now = new Date()) {
  const current = new Set(documents.filter(document => document.verified === true
    && MONTH.test(document.statementMonth || "")
    && (!document.staleAt || Date.parse(document.staleAt) > now.getTime()))
    .map(document => document.statementMonth));
  return required.filter(month => !current.has(month));
}

export function messageFor({ firstName, missingMonths }) {
  return {
    version: "statement-request.v1",
    subject: "Updated business bank statements",
    text: `Hi ${clean(firstName) || "there"},\n\nTo review current business financing options, please reply with your complete business bank statement${missingMonths.length === 1 ? "" : "s"} for ${missingMonths.join(", ")}. We will review the documents before discussing any potential terms.\n\nThank you,\nSierra Capital Funding`
  };
}

export function validateRecoveryIntake(input = {}) {
  if (!["historical", "new"].includes(input.lane)) throw new Error("CANONICAL_LANE_REQUIRED");
  if (input.sourceArtifactType === "raw_application" || input.rawApplication === true) throw new Error("RAW_APPLICATION_FORBIDDEN");
  if (input.canonicalDealVerified !== true || !clean(input.canonicalDealEvidenceId)) throw new Error("CANONICAL_SINGLE_DEAL_PRECONDITION_REQUIRED");
  if (input.lane === "new" && (input.applicationType !== "CM-100" || input.integrityVerified !== true || input.completed !== true)) throw new Error("NEW_APPLICATION_NOT_CANONICAL_CM100");
  if (input.consentBasis?.verified !== true || !clean(input.consentBasis?.evidenceId)) throw new Error("VERIFIED_CONSENT_BASIS_REQUIRED");
  const evidenceIds = [...new Set((input.evidenceIds || []).map(value => clean(value)).filter(Boolean))];
  if (!evidenceIds.length) throw new Error("SOURCE_EVIDENCE_REQUIRED");
  return { ...input, email: canonicalEmail(input.email), evidenceIds };
}

export async function ingestRecoveryCandidate(store, input, { now = new Date() } = {}) {
  const value = validateRecoveryIntake(input);
  const identity = recoveryIdentity(value);
  const requiredMonths = requiredStatementMonths({ asOf: now, jurisdiction: value.jurisdiction, lane: value.lane, authoritativeMissingMonths: value.authoritativeMissingMonths, documents: value.documents });
  const missingMonths = missingStatementMonths(requiredMonths, value.documents, now);
  const candidate = {
    ...identity,
    lane: value.lane,
    sourceApplicationId: value.sourceApplicationId,
    email: value.email,
    firstName: clean(value.firstName) || null,
    requiredMonths,
    missingMonths,
    evidenceIds: value.evidenceIds,
    consentEvidenceId: value.consentBasis.evidenceId,
    canonicalDealEvidenceId: value.canonicalDealEvidenceId,
    documents: value.documents || [],
    businessIdentity: clean(value.businessIdentity) || null,
    cashFlowSummary: value.cashFlowSummary || null,
    priorPositions: value.priorPositions || [],
    fundingEvidence: value.fundingEvidence || [],
    safePersonalizationCues: value.safePersonalizationCues || [],
    confidence: Number(value.confidence || 0),
    canonicalApplicationOnly: true,
    rawApplicationCrmWrite: false
  };
  const evidenceVersion = digest(value.evidenceIds.slice().sort().join(":"));
  const intent = value.lane === "historical" && missingMonths.length
    ? { kind: "prism_precontact", key: `prism-precontact:${identity.dealId}:${evidenceVersion}`, evidenceVersion }
    : missingMonths.length
      ? { kind: "statement_request", key: `statement-request:${identity.dealId}:${requiredMonths.join(".")}:${RECOVERY_POLICY.contract}` }
      : { kind: "prism_wakeup", key: `prism:${identity.dealId}:${requiredMonths.join(".")}` };
  return store.transactIntake(candidate, intent);
}

export function suppressionDecision(candidate, suppressions = [], contacts = [], now = new Date()) {
  const hit = suppressions.find(item => SUPPRESSION_REASONS.has(item.reason) && (!item.expiresAt || Date.parse(item.expiresAt) > now));
  if (hit) return { allowed: false, reason: hit.reason };
  if (contacts.some(item => Date.parse(item.at) > now.getTime() - RECOVERY_POLICY.minContactDays * 86400000)) return { allowed: false, reason: "contact_frequency" };
  if (Number(candidate.attempts || 0) >= RECOVERY_POLICY.maxAttempts) return { allowed: false, reason: "attempt_limit" };
  return { allowed: true };
}

function verifiedOutboundEvidence(result) {
  const receipt = result?.receipt || result;
  const sierra = result?.sierra;
  if (!receipt?.messageId || !Array.isArray(receipt.accepted) || receipt.accepted.length === 0 || (receipt.rejected || []).length > 0) throw new Error("CLEAN_PROVIDER_RECEIPT_REQUIRED");
  if (!sierra?.verification?.ok || sierra.verification.direction !== "outbound" || sierra.verification.notification_exists !== true) throw new Error("SIERRA_OUTBOUND_READBACK_REQUIRED");
  return { messageId: receipt.messageId, accepted: receipt.accepted, rejected: receipt.rejected || [], sierraReadBack: sierra.verification };
}

export async function processRecoveryIntent(store, intent, {
  release = process.env.GEORGIE_FINANCING_OUTREACH_RELEASE || "hold",
  send = sendClientMessageAndVerify,
  prismAdapter = null
} = {}) {
  if (!["statement_request", "prism_wakeup", "prism_precontact"].includes(intent.kind)) return store.recordDownstreamFailure(intent, `UNCONNECTED_INTENT_ADAPTER:${intent.kind || "unknown"}`);
  if (intent.kind === "prism_precontact") {
    const [{ buildPrismPrecontactPacket }, { createUploadTokenRequest }] = await Promise.all([import("./financing-recovery-evidence.js"), import("./financing-recovery-engagement.js")]);
    const packet = buildPrismPrecontactPacket(intent);
    const origin = String(process.env.GEORGIE_RECOVERY_UPLOAD_ORIGIN || "").replace(/\/$/, "");
    if (!origin) return store.recordDownstreamFailure(intent, "SECURE_UPLOAD_ORIGIN_UNAVAILABLE");
    const upload = createUploadTokenRequest({ applicantId: intent.applicantId, episodeId: intent.dealId, requestedMonths: intent.missingMonths, expiresAt: new Date(Date.now() + 7 * 86400000) });
    await store.issueUploadToken(upload);
    return store.recordPrismPrecontact(intent, packet, `${origin}/recovery/#${upload.token}`);
  }
  if (intent.kind === "prism_wakeup") {
    if (!prismAdapter || prismAdapter.contract !== PRISM_ADAPTER_CONTRACT || typeof prismAdapter.submit !== "function") return store.recordDownstreamFailure(intent, "PRISM_ADAPTER_UNAVAILABLE");
    try {
      const result = await prismAdapter.submit({ dealId: intent.dealId, idempotencyKey: intent.idempotency_key || intent.key, evidenceIds: intent.evidenceIds || [] });
      if (!result?.receiptId || result.readBack?.verified !== true) throw new Error("PRISM_RECEIPT_READBACK_REQUIRED");
      return store.recordDownstreamReceipt(intent, result);
    } catch (error) {
      await store.recordDownstreamFailure(intent, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  const gate = await store.checkGlobalSuppression(intent);
  if (!gate?.allowed) return store.blockIntent(intent, gate?.reason || "SUPPRESSION_STATE_UNCERTAIN");
  if (release !== "canary") return store.holdIntent(intent, "RELEASE_HOLD");
  try {
    let message = messageFor(intent);
    if (intent.prismPacket) {
      const { recoveryTemplates } = await import("./financing-recovery-engagement.js");
      const template = recoveryTemplates({ channel: "email", firstName: intent.firstName, businessIdentity: intent.businessIdentity, missingMonths: intent.missingMonths, secureLink: intent.secureLink, prismPacket: intent.prismPacket });
      message = { version: template.contract, subject: template.subject, text: template.body };
    }
    const result = await send(intent.userId || "primary", {
      reference: intent.dealId,
      to: intent.email,
      ...message,
      idempotencyKey: intent.idempotency_key || intent.key,
      threadId: intent.threadId || intent.thread_id
    });
    return store.recordProviderReceipt(intent, verifiedOutboundEvidence(result));
  } catch (error) {
    await store.recordProviderFailure(intent, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function receiveRecoveryReply(store, input = {}) {
  if (!clean(input.providerMessageId) || !clean(input.threadId) || !clean(input.dealId)) throw new Error("EXACT_REPLY_IDENTITY_REQUIRED");
  return store.transactReply({
    ...input,
    replyKey: `reply:${digest(`${input.providerMessageId}:${input.threadId}:${input.dealId}`)}`,
    prismKey: input.complete ? `prism:${input.dealId}:${clean(input.coverageVersion)}` : null,
    closerKey: input.ambiguous || input.sensitive || input.qualified ? `closer:${input.providerMessageId}` : null,
    acknowledgementKey: !input.complete && !input.ambiguous && !input.sensitive && !input.qualified ? `ack:${input.providerMessageId}:${clean(input.coverageVersion)}` : null
  });
}

export async function ingestSuppressionEvent(store, input = {}) {
  const reason = clean(input.reason);
  if (!SUPPRESSION_REASONS.has(reason)) throw new Error("SUPPORTED_SUPPRESSION_REASON_REQUIRED");
  if (!clean(input.evidenceId) || !clean(input.sourceEventId)) throw new Error("SUPPRESSION_EVIDENCE_REQUIRED");
  if (!input.email && !input.applicantId) throw new Error("SUPPRESSION_IDENTITY_REQUIRED");
  return store.transactSuppression({ ...input, reason, email: input.email ? canonicalEmail(input.email) : null, idempotencyKey: `suppression:${input.source}:${input.sourceEventId}` });
}

export function prioritizeHistoricalRehashes(candidates = []) {
  return candidates.map((candidate, index) => ({ candidate, index, score: Number(candidate.expectedReturn || 0) * Math.max(0, Math.min(1, Number(candidate.confidence || 0))) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.candidate);
}
