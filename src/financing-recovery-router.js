import express from "express";
import crypto from "node:crypto";
import { ingestRecoveryCandidate, ingestSuppressionEvent, receiveRecoveryReply } from "./financing-recovery.js";
import { completeStatementUpload, createUploadTokenRequest } from "./financing-recovery-engagement.js";
import { supabaseRecoveryStore } from "./financing-recovery-worker.js";
import { createSupabaseStatementStorage } from "./integrations/financing-recovery-adapters.js";
import { recoveryOperationalReport } from "./financing-recovery-observability.js";

const RECOVERY_BUCKET = "georgie-recovery-statements";
const MAX_RECOVERY_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_RECOVERY_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
const encodePath = value => String(value).split("/").map(encodeURIComponent).join("/");
const tokenHash = token => crypto.createHash("sha256").update(String(token)).digest("hex");

function authorized(req) {
  const expected = String(process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN || "");
  const actual = String(req.get("x-georgie-recovery-token") || "");
  if (!expected || expected.length < 32 || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function storageConfig() {
  const url = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
  if (!/^https:\/\//.test(url) || !key) throw new Error("SUPABASE_STORAGE_NOT_CONFIGURED");
  return { url, key, headers: { apikey: key, authorization: `Bearer ${key}` } };
}

async function signDirectUpload({ objectPath }) {
  const { url, headers } = storageConfig();
  const endpoint = `${url}/storage/v1/object/upload/sign/${RECOVERY_BUCKET}/${encodePath(objectPath)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "x-upsert": "false" },
    body: "{}",
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url) throw new Error(`RECOVERY_SIGNED_UPLOAD_${response.status}`);
  const signedUrl = /^https:\/\//.test(data.url) ? data.url : `${url}/storage/v1${String(data.url).startsWith("/") ? "" : "/"}${data.url}`;
  return { signedUrl, objectPath, expiresInSeconds: 7200 };
}

async function fetchPrivateObject(objectPath) {
  const { url, headers } = storageConfig();
  const response = await fetch(`${url}/storage/v1/object/${RECOVERY_BUCKET}/${encodePath(objectPath)}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`RECOVERY_STAGED_OBJECT_${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_RECOVERY_UPLOAD_BYTES) throw new Error("RECOVERY_FILE_TOO_LARGE");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_RECOVERY_UPLOAD_BYTES) throw new Error("RECOVERY_FILE_TOO_LARGE");
  return buffer;
}

async function deletePrivateObject(objectPath) {
  const { url, headers } = storageConfig();
  const response = await fetch(`${url}/storage/v1/object/${RECOVERY_BUCKET}`, {
    method: "DELETE",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [objectPath] }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok && response.status !== 404) throw new Error(`RECOVERY_STAGING_CLEANUP_${response.status}`);
}

function validateUploadMetadata(input = {}) {
  const name = String(input.name || "statement").slice(0, 180);
  const mimeType = String(input.mimeType || "").toLowerCase();
  const size = Number(input.size || 0);
  const expectedMonth = String(input.expectedMonth || "").slice(0, 7);
  if (!ALLOWED_RECOVERY_MIME.has(mimeType)) throw new Error("RECOVERY_FILE_TYPE_NOT_ALLOWED");
  if (!Number.isFinite(size) || size <= 0 || size > MAX_RECOVERY_UPLOAD_BYTES) throw new Error("RECOVERY_FILE_TOO_LARGE");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(expectedMonth)) throw new Error("RECOVERY_STATEMENT_MONTH_NOT_REQUESTED");
  return { name, mimeType, size, expectedMonth };
}

function monthAllowed(session, expectedMonth) {
  return Array.isArray(session?.slots) && session.slots.some(slot => String(slot?.month || "").slice(0, 7) === expectedMonth && slot?.status !== "verified");
}

export function createFinancingRecoveryRouter({ store = supabaseRecoveryStore(), malwareScan = null, documentValidator = null, statementStorage = createSupabaseStatementStorage() } = {}) {
  const router = express.Router();
  router.get("/review-session", (_req, res) => {
    res.set("Cache-Control", "no-store");
    const enabled = process.env.VERCEL_ENV === "preview";
    if (!enabled) return res.status(404).json({ ok: false, error: "UPLOAD_SESSION_NOT_FOUND" });
    return res.json({ ok: true, session: { status: "active", reviewMode: true, firstName: "Sierra Review Team", businessName: "Sierra Review Company", expiresAt: "2099-12-31T23:59:59.000Z", complete: false, slots: [{ month: "2026-07", status: "open" }, { month: "2026-08", status: "open" }] } });
  });
  router.get("/upload-session", async (req, res) => {
    try {
      const token = String(req.get("x-recovery-upload-token") || "");
      if (token.length < 32) throw new Error("UPLOAD_TOKEN_INVALID");
      const result = await store.getUploadSession(tokenHash(token));
      if (!result) return res.status(404).json({ ok: false, error: "UPLOAD_SESSION_NOT_FOUND" });
      res.set("Cache-Control", "no-store").json({ ok: true, session: result });
    } catch (error) { res.status(400).set("Cache-Control", "no-store").json({ ok: false, error: error instanceof Error ? error.message : "UPLOAD_SESSION_REJECTED" }); }
  });
  router.post("/upload-authorize", async (req, res) => {
    try {
      const token = String(req.get("x-recovery-upload-token") || "");
      if (token.length < 32) throw new Error("UPLOAD_TOKEN_INVALID");
      const meta = validateUploadMetadata(req.body || {});
      const hash = tokenHash(token);
      const session = await store.getUploadSession(hash);
      if (!session || session.status !== "active") throw new Error("UPLOAD_TOKEN_INVALID");
      if (!monthAllowed(session, meta.expectedMonth)) throw new Error("RECOVERY_STATEMENT_MONTH_NOT_REQUESTED");
      const ext = meta.mimeType === "application/pdf" ? "pdf" : meta.mimeType === "image/png" ? "png" : "jpg";
      const objectPath = `incoming/${hash}/${meta.expectedMonth}/${crypto.randomUUID()}.${ext}`;
      const signed = await signDirectUpload({ objectPath });
      res.set("Cache-Control", "no-store").json({ ok: true, upload: { ...signed, maxBytes: MAX_RECOVERY_UPLOAD_BYTES, mimeType: meta.mimeType } });
    } catch (error) {
      res.status(400).set("Cache-Control", "no-store").json({ ok: false, error: error instanceof Error ? error.message : "RECOVERY_UPLOAD_AUTHORIZATION_REJECTED" });
    }
  });
  router.post("/upload-complete", async (req, res) => {
    let stagedPath = "";
    try {
      const token = String(req.get("x-recovery-upload-token") || "");
      if (token.length < 32) throw new Error("UPLOAD_TOKEN_INVALID");
      const meta = validateUploadMetadata(req.body || {});
      const hash = tokenHash(token);
      stagedPath = String(req.body?.objectPath || "");
      const requiredPrefix = `incoming/${hash}/${meta.expectedMonth}/`;
      if (!stagedPath.startsWith(requiredPrefix) || stagedPath.includes("..")) throw new Error("RECOVERY_UPLOAD_SCOPE_MISMATCH");
      const session = await store.getUploadSession(hash);
      if (!session || session.status !== "active") throw new Error("UPLOAD_TOKEN_INVALID");
      if (!monthAllowed(session, meta.expectedMonth)) throw new Error("RECOVERY_STATEMENT_MONTH_NOT_REQUESTED");
      const buffer = await fetchPrivateObject(stagedPath);
      if (buffer.length !== meta.size) throw new Error("RECOVERY_UPLOAD_SIZE_MISMATCH");
      const [{ createProductionRecoveryUploadAdapters }, { handoffRecoveryStatementToPrism }] = await Promise.all([
        import("./integrations/recovery-upload-validation.js"),
        import("./integrations/recovery-prism-handoff.js")
      ]);
      const production = createProductionRecoveryUploadAdapters();
      const scan = malwareScan || production.scan;
      const validateDocument = documentValidator || production.validateDocument;
      const file = { name: meta.name, mimeType: meta.mimeType, buffer };
      const scopedValidateDocument = args => validateDocument({ ...args, expectedMonth: meta.expectedMonth });
      const result = await completeStatementUpload(store, { token, file, scan, validateDocument: scopedValidateDocument, storage: statementStorage });
      const prism = await handoffRecoveryStatementToPrism({ store, token, file });
      await deletePrivateObject(stagedPath).catch(error => console.warn("[Georgie][recovery-upload] staging cleanup deferred", { code: error?.message || "cleanup_failed" }));
      res.status(202).set("Cache-Control", "no-store").json({ ok: true, result, prism });
    } catch (error) {
      const message = error instanceof Error ? error.message : "SECURE_UPLOAD_REJECTED";
      console.warn("[Georgie][recovery-upload] rejected", { code: message, staged: Boolean(stagedPath) });
      res.status(400).set("Cache-Control", "no-store").json({ ok: false, error: message });
    }
  });
  router.post("/upload", async (req, res) => {
    try {
      const [{ createProductionRecoveryUploadAdapters }, { handoffRecoveryStatementToPrism }] = await Promise.all([
        import("./integrations/recovery-upload-validation.js"),
        import("./integrations/recovery-prism-handoff.js")
      ]);
      const production = createProductionRecoveryUploadAdapters();
      const scan = malwareScan || production.scan;
      const validateDocument = documentValidator || production.validateDocument;
      const input = req.body?.file || {}, token = String(req.get("x-recovery-upload-token") || req.body?.token || ""), expectedMonth = String(req.body?.expectedMonth || "").slice(0, 7), file = { name: input.name, mimeType: input.mimeType, buffer: Buffer.from(String(input.base64 || ""), "base64") };
      if (!file.buffer.length || file.buffer.length > MAX_RECOVERY_UPLOAD_BYTES) throw new Error("RECOVERY_FILE_TOO_LARGE");
      const scopedValidateDocument = args => validateDocument({ ...args, expectedMonth });
      const result = await completeStatementUpload(store, { token, file, scan, validateDocument: scopedValidateDocument, storage: statementStorage });
      const prism = await handoffRecoveryStatementToPrism({ store, token, file });
      res.status(202).json({ ok: true, result, prism });
    } catch (error) {
      const message = error instanceof Error ? error.message : "SECURE_UPLOAD_REJECTED";
      const safeCode = message === "Cannot find package 'pdf-parse' imported from /var/task/src/integrations/recovery-upload-validation.js" ? "RECOVERY_UPLOAD_VALIDATION_UNAVAILABLE" : message;
      console.warn("[Georgie][recovery-upload] rejected", { code: safeCode });
      res.status(400).json({ ok: false, error: safeCode });
    }
  });
  router.use((req, res, next) => authorized(req) ? next() : res.status(401).json({ ok: false, error: "RECOVERY_INGEST_AUTH_REQUIRED" }));
  const route = handler => async (req, res) => { try { res.status(202).json({ ok: true, result: await handler(store, req.body || {}) }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "RECOVERY_INGEST_REJECTED" }); } };
  router.get("/readiness", (_req, res) => res.set("Cache-Control", "no-store").json({ ok: true, report: recoveryOperationalReport() }));
  router.post("/intake", route(ingestRecoveryCandidate));
  router.post("/reply", route(receiveRecoveryReply));
  router.post("/suppression", route(ingestSuppressionEvent));
  router.post("/upload-token", async (req, res) => { try { const request = createUploadTokenRequest(req.body || {}); await store.issueUploadToken(request); res.status(201).json({ ok: true, token: request.token, expiresAt: request.expiresAt, requestedMonths: request.requestedMonths }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "UPLOAD_TOKEN_REJECTED" }); } });
  router.post("/upload-token/revoke", async (req, res) => { try { res.json({ ok: true, result: await store.revokeUploadToken(tokenHash(req.body?.token || ""), req.body?.evidenceId) }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "UPLOAD_TOKEN_REVOCATION_REJECTED" }); } });
  return router;
}
