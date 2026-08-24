import crypto from "node:crypto";

const SIERRA_URL = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const SIERRA_KEY = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
const BUCKET = "partner-documents";
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/zip",
  "application/x-zip-compressed"
]);

function configured() { return Boolean(SIERRA_URL && SIERRA_KEY); }
function headers(extra = {}) { return { apikey: SIERRA_KEY, authorization: `Bearer ${SIERRA_KEY}`, ...extra }; }
function clean(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function encodeStoragePath(path) { return String(path).split("/").map((part) => encodeURIComponent(part)).join("/"); }
function safeFilename(value) {
  const source = clean(value || "attachment", 220).replace(/[\\/\u0000-\u001f\u007f]+/g, "-").replace(/\s+/g, "-");
  return source.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-") || "attachment";
}

async function rpc(name, body = {}) {
  if (!configured()) throw new Error("Sierra correspondence connection is not configured");
  const response = await fetch(`${SIERRA_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${name} failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`);
  }
  return response.json();
}

export function sierraCorrespondenceConfigured() { return configured(); }

export async function resolveCorrespondenceTarget(userId, message = {}) {
  return rpc("georgie_workforce_resolve_correspondence_target", {
    p_user_id: String(userId || "primary"),
    p_sender_email: clean(message.from, 500),
    p_subject: clean(message.subject, 998) || null,
    p_body_text: clean(message.text, 30000) || null
  });
}

export function classifyCorrespondenceAttachment(file = {}) {
  const filename = clean(file.filename, 220).toLowerCase();
  if (/bank|statement|checking|savings|account[-_ ]?\d{2,4}/i.test(filename)) return { documentType: "bank_statement", documentLabel: "Bank statement" };
  if (/application|capital[-_ ]?app|funding[-_ ]?app|signed[-_ ]?app/i.test(filename)) return { documentType: "application", documentLabel: "Application" };
  return { documentType: "supporting_document", documentLabel: "Supporting document" };
}

export async function uploadCorrespondenceAttachment(target = {}, message = {}, file = {}) {
  if (!configured()) throw new Error("Sierra correspondence connection is not configured");
  const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content || "");
  if (!content.length) throw new Error(`Attachment ${clean(file.filename, 120) || "attachment"} is empty`);
  if (content.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment ${clean(file.filename, 120)} exceeds Sierra's 50 MB document limit`);
  const mimeType = clean(file.contentType || file.mimeType, 160).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error(`Attachment MIME type is not allowed: ${mimeType || "unknown"}`);
  const referralId = clean(target.referral_id || target.referralId, 80);
  const partnerId = clean(target.partner_id || target.partnerId || referralId, 80) || referralId;
  if (!referralId) throw new Error("Resolved Sierra referral identity is required before attachment upload");
  const messageIdentity = clean(message.messageId || `${message.mailboxId || "mail"}:${message.uid || "unknown"}`, 500);
  const contentHash = sha256(content);
  const messageHash = sha256(messageIdentity).slice(0, 20);
  const filename = safeFilename(file.filename);
  const storagePath = `${partnerId}/${referralId}/georgie-mail/${messageHash}/${contentHash.slice(0, 16)}-${filename}`;
  const response = await fetch(`${SIERRA_URL}/storage/v1/object/${BUCKET}/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: headers({ "content-type": mimeType, "x-upsert": "false" }),
    body: content,
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok && response.status !== 409) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Sierra document upload failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const classification = classifyCorrespondenceAttachment(file);
  return {
    storage_path: storagePath,
    filename,
    mime_type: mimeType,
    size_bytes: content.length,
    content_hash: contentHash,
    document_type: classification.documentType,
    document_label: classification.documentLabel,
    deduplicated_storage: response.status === 409
  };
}

export async function ingestInboundCorrespondence(userId, { target, message, attachments = [] } = {}) {
  if (!target?.ok || !target?.reference_number) throw new Error("A uniquely resolved Sierra deal is required before correspondence ingestion");
  const uploaded = [];
  const rejected = [];
  for (const file of attachments) {
    try { uploaded.push(await uploadCorrespondenceAttachment(target, message, file)); }
    catch (error) { rejected.push({ filename: clean(file?.filename, 220), error: error instanceof Error ? error.message : String(error) }); }
  }
  const providerMessageId = clean(message.messageId || `neo:${message.mailboxId}:${message.uid}`, 500);
  const idempotencyKey = `neo-inbound:${sha256(`${message.mailboxId || "mail"}:${providerMessageId}`)}`;
  const result = await rpc("georgie_workforce_ingest_correspondence_v1", {
    p_user_id: String(userId || "primary"),
    p_reference: target.reference_number,
    p_provider_message_id: providerMessageId,
    p_sender_email: clean(message.from, 500),
    p_recipient_email: clean(message.to, 500),
    p_subject: clean(message.subject, 998),
    p_body_text: clean(message.text, 30000),
    p_attachments: uploaded,
    p_idempotency_key: idempotencyKey
  });
  const verification = await correspondenceStatus(userId, providerMessageId);
  if (!verification?.ok) throw new Error("Sierra correspondence write did not read back after ingestion");
  if (uploaded.length !== Number(verification.document_count || 0) && !result?.deduplicated) throw new Error("Sierra correspondence document count did not read back exactly");
  if (verification.notification_exists !== true) throw new Error("Sierra internal correspondence notification did not read back");
  return { ...result, verification, uploaded, rejected, idempotencyKey };
}

export async function recordOutboundCorrespondence(userId, { reference, receipt, message, eventType = "georgie_client_message" } = {}) {
  if (!receipt?.messageId) throw new Error("SMTP provider message receipt is required");
  const providerMessageId = clean(receipt.messageId, 500);
  const idempotencyKey = `neo-outbound:${sha256(providerMessageId)}`;
  const result = await rpc("georgie_workforce_record_outbound_correspondence_v1", {
    p_user_id: String(userId || "primary"),
    p_reference: clean(reference, 120),
    p_provider_message_id: providerMessageId,
    p_sender_email: clean(receipt.from, 500),
    p_recipient_email: clean(receipt.to || message?.to, 500),
    p_subject: clean(message?.subject || receipt.subject, 998),
    p_body_text: clean(message?.text, 30000),
    p_event_type: clean(eventType, 120),
    p_idempotency_key: idempotencyKey
  });
  const verification = await correspondenceStatus(userId, providerMessageId);
  if (!verification?.ok || verification.direction !== "outbound" || verification.notification_exists !== true) throw new Error("Outbound correspondence receipt did not read back completely from Sierra");
  return { ...result, verification, idempotencyKey };
}

export async function correspondenceStatus(userId, providerMessageId) {
  return rpc("georgie_workforce_correspondence_status", { p_user_id: String(userId || "primary"), p_provider_message_id: clean(providerMessageId, 500) });
}
