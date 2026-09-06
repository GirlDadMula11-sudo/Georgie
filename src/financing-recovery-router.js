import express from "express";
import crypto from "node:crypto";
import { ingestRecoveryCandidate, ingestSuppressionEvent, receiveRecoveryReply } from "./financing-recovery.js";
import { completeStatementUpload, createUploadTokenRequest } from "./financing-recovery-engagement.js";
import { supabaseRecoveryStore } from "./financing-recovery-worker.js";
import { createSupabaseStatementStorage } from "./integrations/financing-recovery-adapters.js";
import { recoveryOperationalReport } from "./financing-recovery-observability.js";

function authorized(req) {
  const expected = String(process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN || "");
  const actual = String(req.get("x-georgie-recovery-token") || "");
  if (!expected || expected.length < 32 || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

async function trackFunnel(store, token, eventType, metadata = {}) {
  if (!token || token.length < 32 || typeof store.recordFunnelEvent !== "function") return null;
  try {
    return await store.recordFunnelEvent({
      tokenHash: tokenHash(token),
      eventType,
      eventKey: `${eventType}:${crypto.randomUUID()}`,
      metadata
    });
  } catch (error) {
    // Analytics must never break secure upload, Prism, or recovery processing.
    console.warn("[Georgie][recovery-funnel] tracking unavailable", { eventType, code: error instanceof Error ? error.message : String(error) });
    return null;
  }
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
      if (result.status === "active") await trackFunnel(store, token, "secure_link_opened", { complete: result.complete === true });
      res.set("Cache-Control", "no-store").json({ ok: true, session: result });
    } catch (error) { res.status(400).set("Cache-Control", "no-store").json({ ok: false, error: error instanceof Error ? error.message : "UPLOAD_SESSION_REJECTED" }); }
  });
  router.post("/upload", async (req, res) => {
    const token = String(req.get("x-recovery-upload-token") || req.body?.token || "");
    const expectedMonth = String(req.body?.expectedMonth || "").slice(0, 7);
    try {
      const [{ createProductionRecoveryUploadAdapters }, { handoffRecoveryStatementToPrism }] = await Promise.all([
        import("./integrations/recovery-upload-validation.js"),
        import("./integrations/recovery-prism-handoff.js")
      ]);
      const production = createProductionRecoveryUploadAdapters();
      const scan = malwareScan || production.scan;
      const validateDocument = documentValidator || production.validateDocument;
      const input = req.body?.file || {};
      const file = { name: input.name, mimeType: input.mimeType, buffer: Buffer.from(String(input.base64 || ""), "base64") };
      await trackFunnel(store, token, "upload_attempted", { expectedMonth, mimeType: String(file.mimeType || "").slice(0, 80), sizeBytes: file.buffer.length });
      const scopedValidateDocument = args => validateDocument({ ...args, expectedMonth });
      const result = await completeStatementUpload(store, { token, file, scan, validateDocument: scopedValidateDocument, storage: statementStorage });
      await trackFunnel(store, token, "statement_verified", { expectedMonth, duplicate: result?.created === false });
      if (result?.complete === true) await trackFunnel(store, token, "package_complete", { expectedMonth });
      const prism = await handoffRecoveryStatementToPrism({ store, token, file });
      await trackFunnel(store, token, "prism_handoff", { expectedMonth, receiptId: String(prism?.receiptId || prism?.receipt?.receiptId || "").slice(0, 200) });
      res.status(202).json({ ok: true, result, prism });
    } catch (error) {
      const message = error instanceof Error ? error.message : "SECURE_UPLOAD_REJECTED";
      const safeCode = message === "Cannot find package 'pdf-parse' imported from /var/task/src/integrations/recovery-upload-validation.js" ? "RECOVERY_UPLOAD_VALIDATION_UNAVAILABLE" : message;
      await trackFunnel(store, token, "upload_rejected", { expectedMonth, code: safeCode.slice(0, 160) });
      console.warn("[Georgie][recovery-upload] rejected", { code: safeCode });
      res.status(400).json({ ok: false, error: safeCode });
    }
  });
  router.use((req, res, next) => authorized(req) ? next() : res.status(401).json({ ok: false, error: "RECOVERY_INGEST_AUTH_REQUIRED" }));
  const route = handler => async (req, res) => { try { res.status(202).json({ ok: true, result: await handler(store, req.body || {}) }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "RECOVERY_INGEST_REJECTED" }); } };
  router.get("/readiness", (_req, res) => res.set("Cache-Control", "no-store").json({ ok: true, report: recoveryOperationalReport() }));
  router.get("/funnel", async (_req, res) => { try { res.set("Cache-Control", "no-store").json({ ok: true, funnel: await store.getFunnelReport() }); } catch (error) { res.status(503).set("Cache-Control", "no-store").json({ ok: false, error: error instanceof Error ? error.message : "RECOVERY_FUNNEL_UNAVAILABLE" }); } });
  router.post("/intake", route(ingestRecoveryCandidate));
  router.post("/reply", route(receiveRecoveryReply));
  router.post("/suppression", route(ingestSuppressionEvent));
  router.post("/upload-token", async (req, res) => { try { const request = createUploadTokenRequest(req.body || {}); await store.issueUploadToken(request); res.status(201).json({ ok: true, token: request.token, expiresAt: request.expiresAt, requestedMonths: request.requestedMonths }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "UPLOAD_TOKEN_REJECTED" }); } });
  router.post("/upload-token/revoke", async (req, res) => { try { res.json({ ok: true, result: await store.revokeUploadToken(tokenHash(String(req.body?.token || "")), req.body?.evidenceId) }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "UPLOAD_TOKEN_REVOCATION_REJECTED" }); } });
  return router;
}
