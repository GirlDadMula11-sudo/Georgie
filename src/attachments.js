import crypto from "node:crypto";
import path from "node:path";
import { readCloudState, writeCloudState } from "./cloud-state.js";

export const ATTACHMENT_BUCKET = "georgie-conversation-files";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TURN = 5;

const ALLOWED = new Map([
  [".pdf", ["application/pdf"]], [".doc", ["application/msword"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"]],
  [".xls", ["application/vnd.ms-excel"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"]],
  [".ppt", ["application/vnd.ms-powerpoint"]],
  [".pptx", ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"]],
  [".csv", ["text/csv", "text/plain", "application/vnd.ms-excel"]], [".txt", ["text/plain"]],
  [".rtf", ["application/rtf", "text/rtf"]], [".json", ["application/json", "text/plain"]],
  [".jpg", ["image/jpeg"]], [".jpeg", ["image/jpeg"]], [".png", ["image/png"]],
  [".webp", ["image/webp"]], [".gif", ["image/gif"]],
]);

function storageConfig() {
  const url = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url || !key) throw new Error("Secure attachment storage is not configured");
  return { url, key };
}

function safeSegment(value, fallback = "file") {
  return String(value || fallback).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || fallback;
}

function hasExpectedSignature(buffer, ext) {
  if (ext === ".pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if ([".jpg", ".jpeg"].includes(ext)) return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ext === ".png") return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (ext === ".gif") return /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString());
  if (ext === ".webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if ([".docx", ".xlsx", ".pptx"].includes(ext)) return buffer[0] === 0x50 && buffer[1] === 0x4b;
  return true;
}

export function validateAttachment(file) {
  if (!file?.buffer?.length) throw new Error("An attached file was empty");
  if (file.buffer.length > MAX_ATTACHMENT_BYTES) throw new Error(`${file.originalname || "File"} exceeds the 20 MB limit`);
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  const allowedTypes = ALLOWED.get(ext);
  if (!allowedTypes) throw new Error(`${file.originalname || "File"} is not a supported document or image`);
  const mimeType = String(file.mimetype || "application/octet-stream").toLowerCase();
  if (!allowedTypes.includes(mimeType)) throw new Error(`${file.originalname} has an unexpected file type`);
  if (!hasExpectedSignature(file.buffer, ext)) throw new Error(`${file.originalname} did not match its declared file type`);
  return { ext, mimeType, size: file.buffer.length, sha256: crypto.createHash("sha256").update(file.buffer).digest("hex") };
}

function safeStorageError(detail) {
  return String(detail || "").replace(/[\r\n]+/g, " ").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240);
}

export function missingBucketResponse(status, detail = "") {
  if (Number(status) === 404) return true;
  if (Number(status) !== 400) return false;
  const text = String(detail).toLowerCase();
  return /bucket[^\n]{0,80}(?:not found|does not exist|unknown)/.test(text) || /(?:not found|does not exist|unknown)[^\n]{0,80}bucket/.test(text);
}

export async function ensurePrivateBucket() {
  const { url, key } = storageConfig();
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const check = await fetch(`${url}/storage/v1/bucket/${ATTACHMENT_BUCKET}`, { headers, signal: AbortSignal.timeout(8000) });
  if (check.ok) return;
  const checkDetail = await check.text().catch(() => "");
  if (!missingBucketResponse(check.status, checkDetail)) throw new Error(`Attachment bucket check failed (${check.status})${checkDetail ? `: ${safeStorageError(checkDetail)}` : ""}`);
  const created = await fetch(`${url}/storage/v1/bucket`, { method: "POST", headers, body: JSON.stringify({ id: ATTACHMENT_BUCKET, name: ATTACHMENT_BUCKET, public: false, file_size_limit: MAX_ATTACHMENT_BYTES, allowed_mime_types: [...new Set([...ALLOWED.values()].flat())] }), signal: AbortSignal.timeout(8000) });
  if (!created.ok && created.status !== 409) { const detail = await created.text().catch(() => ""); throw new Error(`Attachment bucket creation failed (${created.status})${detail ? `: ${safeStorageError(detail)}` : ""}`); }
}

async function storeObject(storagePath, file, mimeType) {
  const { url, key } = storageConfig();
  const response = await fetch(`${url}/storage/v1/object/${ATTACHMENT_BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": mimeType, "x-upsert": "false", "cache-control": "private, max-age=31536000, immutable" }, body: file.buffer, signal: AbortSignal.timeout(20000) });
  if (!response.ok) { const detail = await response.text().catch(() => ""); throw new Error(`Secure upload failed for ${file.originalname} (${response.status})${detail ? `: ${safeStorageError(detail)}` : ""}`); }
}

export function attachmentModelParts(attachments = []) {
  return attachments.map((attachment) => attachment.mimeType.startsWith("image/")
    ? { type: "input_image", image_url: `data:${attachment.mimeType};base64,${attachment.buffer.toString("base64")}`, detail: "high" }
    : { type: "input_file", filename: attachment.name, file_data: `data:${attachment.mimeType};base64,${attachment.buffer.toString("base64")}` });
}

export async function persistAttachments({ userId, sessionId, files = [] }) {
  if (!files.length) return [];
  if (files.length > MAX_ATTACHMENTS_PER_TURN) throw new Error(`Attach no more than ${MAX_ATTACHMENTS_PER_TURN} files at once`);
  await ensurePrivateBucket();
  const now = new Date();
  const uploaded = [];
  for (const file of files) {
    const verified = validateAttachment(file);
    const id = crypto.randomUUID();
    const name = safeSegment(file.originalname, `attachment${verified.ext}`);
    const storagePath = `${safeSegment(userId, "primary")}/${safeSegment(sessionId, "session")}/${now.toISOString().slice(0,10)}/${id}-${name}`;
    await storeObject(storagePath, file, verified.mimeType);
    uploaded.push({ id, name: file.originalname.slice(0, 180), mimeType: verified.mimeType, size: verified.size, sha256: verified.sha256, storagePath, bucket: ATTACHMENT_BUCKET, createdAt: now.toISOString(), buffer: file.buffer });
  }
  const state = await readCloudState(userId, "conversation_attachments", { version: 1, items: [] });
  const safeItems = uploaded.map(({ buffer: _buffer, ...item }) => ({ ...item, sessionId }));
  const saved = await writeCloudState(userId, "conversation_attachments", { version: 1, updatedAt: now.toISOString(), items: [...(Array.isArray(state.items) ? state.items : []), ...safeItems].slice(-500) });
  if (!saved) throw new Error("Files uploaded, but durable attachment metadata could not be verified");
  return uploaded;
}

export function publicAttachmentManifest(attachments = []) {
  return attachments.map(({ buffer: _buffer, storagePath: _storagePath, bucket: _bucket, ...safe }) => safe);
}
