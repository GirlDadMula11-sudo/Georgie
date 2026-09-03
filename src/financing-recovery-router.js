import express from "express";
import crypto from "node:crypto";
import { ingestRecoveryCandidate, ingestSuppressionEvent, receiveRecoveryReply } from "./financing-recovery.js";
import { completeStatementUpload, createUploadTokenRequest } from "./financing-recovery-engagement.js";
import { supabaseRecoveryStore } from "./financing-recovery-worker.js";

function authorized(req) {
  const expected = String(process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN || "");
  const actual = String(req.get("x-georgie-recovery-token") || "");
  if (!expected || expected.length < 32 || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function createFinancingRecoveryRouter({ store = supabaseRecoveryStore(), malwareScan = null, documentValidator = null } = {}) {
  const router = express.Router();
  router.post("/upload", async (req, res) => {
    try {
      const file = req.body?.file || {};
      const result = await completeStatementUpload(store, { token: req.body?.token, file: { name: file.name, mimeType: file.mimeType, buffer: Buffer.from(String(file.base64 || ""), "base64") }, scan: malwareScan, validateDocument: documentValidator });
      res.status(202).json({ ok: true, result });
    } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "SECURE_UPLOAD_REJECTED" }); }
  });
  router.use((req, res, next) => authorized(req) ? next() : res.status(401).json({ ok: false, error: "RECOVERY_INGEST_AUTH_REQUIRED" }));
  const route = handler => async (req, res) => {
    try { res.status(202).json({ ok: true, result: await handler(store, req.body || {}) }); }
    catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "RECOVERY_INGEST_REJECTED" }); }
  };
  router.post("/intake", route(ingestRecoveryCandidate));
  router.post("/reply", route(receiveRecoveryReply));
  router.post("/suppression", route(ingestSuppressionEvent));
  router.post("/upload-token", async (req, res) => {
    try { const request = createUploadTokenRequest(req.body || {}); await store.issueUploadToken(request); res.status(201).json({ ok: true, token: request.token, expiresAt: request.expiresAt, requestedMonths: request.requestedMonths }); }
    catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "UPLOAD_TOKEN_REJECTED" }); }
  });
  router.post("/upload-token/revoke", async (req, res) => {
    try { res.json({ ok: true, result: await store.revokeUploadToken(crypto.createHash("sha256").update(String(req.body?.token || "")).digest("hex"), req.body?.evidenceId) }); }
    catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "UPLOAD_TOKEN_REVOCATION_REJECTED" }); }
  });
  return router;
}
