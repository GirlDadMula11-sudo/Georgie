import crypto from "node:crypto";
import { validateAttachment } from "./attachments.js";

export const SMS_ADAPTER_CONTRACT = "georgie.sms.v1";
export const UPLOAD_TOKEN_CONTRACT = "georgie.recovery-upload-token.v1";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");

export function createUploadTokenRequest({ applicantId, episodeId, requestedMonths, expiresAt, now = new Date() }) {
  if (!applicantId || !episodeId || !Array.isArray(requestedMonths) || requestedMonths.length !== 2 || new Set(requestedMonths).size !== 2 || !requestedMonths.every(month => MONTH.test(month))) throw new Error("EXACT_TWO_UPLOAD_MONTHS_REQUIRED");
  const expiry = new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime()) || expiry <= now || expiry > new Date(now.getTime() + 14 * 86400000)) throw new Error("BOUNDED_UPLOAD_EXPIRY_REQUIRED");
  const token = crypto.randomBytes(32).toString("base64url");
  return { contract: UPLOAD_TOKEN_CONTRACT, token, tokenHash: hash(token), applicantId, episodeId, requestedMonths, expiresAt: expiry.toISOString(), slots: requestedMonths.map(month => ({ month, status: "open" })) };
}

export async function completeStatementUpload(store, { token, file, scan, validateDocument }) {
  if (!token || typeof scan !== "function" || typeof validateDocument !== "function") throw new Error("SECURE_UPLOAD_VALIDATORS_REQUIRED");
  if (file?.buffer?.length > 10 * 1024 * 1024) throw new Error("SECURE_UPLOAD_10MB_LIMIT");
  const verifiedFile = validateAttachment({ buffer: file.buffer, originalname: file.name, mimetype: file.mimeType });
  const malware = await scan({ buffer: file.buffer, contentHash: verifiedFile.sha256 });
  if (malware?.clean !== true || !malware.receiptId) throw new Error("MALWARE_SCAN_CLEARANCE_REQUIRED");
  const tokenState = await store.resolveUploadToken(hash(token));
  if (!tokenState || tokenState.revoked || Date.parse(tokenState.expiresAt) <= Date.now()) throw new Error("UPLOAD_TOKEN_INVALID");
  const document = await validateDocument({ buffer: file.buffer, contentHash: verifiedFile.sha256, requestedMonths: tokenState.requestedMonths, applicantId: tokenState.applicantId });
  if (document?.verified !== true || !tokenState.requestedMonths.includes(document.statementMonth) || document.businessMatch !== true) throw new Error("STATEMENT_MONTH_OR_BUSINESS_MISMATCH");
  return store.transactUploadCompletion({ tokenHash: hash(token), applicantId: tokenState.applicantId, episodeId: tokenState.episodeId, contentHash: verifiedFile.sha256, statementMonth: document.statementMonth, evidenceIds: [...new Set([malware.receiptId, ...(document.evidenceIds || [])])], idempotencyKey: `upload:${hash(token)}:${verifiedFile.sha256}` });
}

export function recoveryTemplates({ channel, firstName, businessIdentity, missingMonths, secureLink, prismPacket }) {
  if (!Array.isArray(missingMonths) || missingMonths.length !== 2 || !missingMonths.every(month => MONTH.test(month))) throw new Error("EXACT_TWO_TEMPLATE_MONTHS_REQUIRED");
  if (!/^https:\/\//.test(secureLink || "")) throw new Error("SECURE_UPLOAD_LINK_REQUIRED");
  const personalized = prismPacket?.personalizationMode === "verified";
  const greeting = clean(firstName, 60) || "there";
  const business = personalized && clean(businessIdentity, 100) ? ` for ${clean(businessIdentity, 100)}` : "";
  const months = missingMonths.join(" and ");
  const common = `Sierra already has your application information${business}; no new application is needed. Please securely upload the complete ${months} business bank statements: ${secureLink}`;
  if (channel === "sms") return { contract: "georgie.recovery-message.v1", channel, body: `Hi ${greeting} — ${common} Reply STOP to opt out or HELP for help.`, claims: [] };
  if (channel === "email") return { contract: "georgie.recovery-message.v1", channel, subject: "Two updated bank statements needed", body: `Hi ${greeting},\n\n${common}\n\nOnce received, Georgie will keep your review moving and update you here.\n\nBest,\nGeorgie\nSierra Capital Funding`, claims: [] };
  throw new Error("SUPPORTED_RECOVERY_CHANNEL_REQUIRED");
}

export function coordinateChannelStep(state, { channel, step, idempotencyKey }) {
  if (!state?.conversationId || !["email", "sms"].includes(channel) || !step || !idempotencyKey) throw new Error("OMNICHANNEL_STATE_REQUIRED");
  const prior = (state.events || []).find(event => event.step === step && ["intent", "sent", "delivered"].includes(event.status));
  if (prior) return { allowed: false, reason: "same_step_already_active", existingChannel: prior.channel };
  if (state.suppressed || state.stopped) return { allowed: false, reason: "conversation_stopped" };
  return { allowed: true, event: { channel, step, idempotencyKey, status: "intent" } };
}

export function validateSmsAdapter(adapter) {
  return Boolean(adapter?.contract === SMS_ADAPTER_CONTRACT && typeof adapter.send === "function" && typeof adapter.verifyWebhook === "function" && adapter.configured === true && adapter.number && adapter.registrationVerified === true);
}

export function processSmsWebhook(adapter, event, replayStore) {
  if (!validateSmsAdapter(adapter) || adapter.verifyWebhook(event) !== true) throw new Error("SIGNED_SMS_WEBHOOK_REQUIRED");
  const eventId = clean(event.eventId);
  if (!eventId) throw new Error("SMS_EVENT_ID_REQUIRED");
  const command = /^stop\b/i.test(clean(event.body)) ? "STOP" : /^help\b/i.test(clean(event.body)) ? "HELP" : "REPLY";
  return replayStore.transactSmsEvent({ ...event, eventId, command, idempotencyKey: `sms-event:${eventId}` });
}

export function recoveryEconomics(events = []) {
  const sum = type => events.filter(event => event.type === type).reduce((total, event) => total + Number(event.cost || 0), 0);
  return { contract: "georgie.recovery-economics.v1", emailCost: sum("email"), smsCost: sum("sms"), modelCost: sum("model"), documentProcessingCost: sum("document_processing"), recoveredPackages: events.filter(event => event.type === "package_recovered").length, fundedDeals: events.filter(event => event.type === "funded").length, fundedDollars: events.filter(event => event.type === "funded").reduce((total, event) => total + Number(event.amount || 0), 0), revenue: events.filter(event => event.type === "revenue").reduce((total, event) => total + Number(event.amount || 0), 0) };
}

export const GEORGIE_CLOSER_AUTHORITY = Object.freeze({ owner: "georgie", stages: ["initial_outreach", "document_collection", "status", "objection_handling", "offer_explanation", "guardrailed_negotiation", "funding_coordination"], humanEscalationOnly: ["outside_binding_authority", "ambiguity", "compliance_risk", "explicit_client_request"] });

export function uploadProgressAction({ requestedMonths, verifiedMonths = [] }) {
  const missingMonths = requestedMonths.filter(month => !verifiedMonths.includes(month));
  return { complete: missingMonths.length === 0, missingMonths, reminderAllowed: missingMonths.length > 0, copy: missingMonths.length ? `No new application is needed. Please upload the complete ${missingMonths.join(" and ")} business bank statement${missingMonths.length === 1 ? "" : "s"}.` : "Both requested statements are verified; no additional application is needed." };
}
