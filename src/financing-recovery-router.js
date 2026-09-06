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

function supabaseConfig() {
  return {
    url: String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, ""),
    key: String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "")
  };
}

async function readSupabase(path, key, url) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`STAFF_DATA_${response.status}:${data?.message || "unavailable"}`);
  return data;
}

async function requireSierraAdmin(req) {
  const bearer = String(req.get("authorization") || "");
  const accessToken = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
  const { url, key } = supabaseConfig();
  if (!url || !key || !accessToken) return null;

  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(7000)
  });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.id) return null;

  const profiles = await readSupabase(`partner_profiles?select=is_sierra_admin,account_status&id=eq.${encodeURIComponent(user.id)}&limit=1`, key, url);
  const profile = profiles?.[0];
  if (!profile?.is_sierra_admin || profile?.account_status !== "active") return null;
  return { user, url, key };
}

async function staffRehashSnapshot(req) {
  const auth = await requireSierraAdmin(req);
  if (!auth) return { unauthorized: true };
  const { url, key } = auth;

  const [dossiers, contacts, dispatch, funnel] = await Promise.all([
    readSupabase("georgie_rehash_merchant_dossiers?select=id,merchant_id,merchant_name,contact_resolution_state,created_at,updated_at&order=updated_at.desc&limit=300", key, url),
    readSupabase("georgie_contact_resolution?select=dossier_id,status,confidence,candidate_email&order=updated_at.desc&limit=600", key, url).catch(() => []),
    readSupabase("georgie_rehash_email_dispatch?select=dossier_id,status,created_at&order=created_at.desc&limit=1000", key, url).catch(() => []),
    readSupabase("georgie_recovery_funnel_events?select=episode_id,event_type,created_at&order=created_at.desc&limit=1500", key, url).catch(() => [])
  ]);

  const contactByDossier = new Map();
  for (const row of contacts || []) if (!contactByDossier.has(row.dossier_id)) contactByDossier.set(row.dossier_id, row);
  const dispatchByDossier = new Map();
  for (const row of dispatch || []) if (!dispatchByDossier.has(row.dossier_id)) dispatchByDossier.set(row.dossier_id, row);
  const eventsByEpisode = new Map();
  for (const row of funnel || []) {
    const list = eventsByEpisode.get(row.episode_id) || [];
    list.push(row);
    eventsByEpisode.set(row.episode_id, list);
  }

  const rows = (dossiers || []).map(dossier => {
    const contact = contactByDossier.get(dossier.id) || null;
    const latestDispatch = dispatchByDossier.get(dossier.id) || null;
    const events = eventsByEpisode.get(String(dossier.merchant_id)) || [];
    return {
      id: dossier.id,
      merchantId: dossier.merchant_id,
      merchantName: dossier.merchant_name,
      contactState: dossier.contact_resolution_state,
      updatedAt: dossier.updated_at,
      contact: contact ? {
        status: contact.status,
        confidence: contact.confidence,
        email: contact.candidate_email
      } : null,
      outreach: latestDispatch ? { status: latestDispatch.status, at: latestDispatch.created_at } : null,
      engagement: {
        opened: events.some(e => e.event_type === "secure_link_opened"),
        attemptedUpload: events.some(e => e.event_type === "upload_attempted"),
        statementVerified: events.some(e => e.event_type === "statement_verified"),
        packageComplete: events.some(e => e.event_type === "package_complete"),
        prismHandoff: events.some(e => e.event_type === "prism_handoff")
      }
    };
  });

  const counts = {
    total: rows.length,
    verified: rows.filter(r => r.contact?.status === "verified" && Number(r.contact?.confidence || 0) >= 0.85).length,
    needsResearch: rows.filter(r => !(r.contact?.status === "verified" && Number(r.contact?.confidence || 0) >= 0.85)).length,
    sent: rows.filter(r => ["delivered", "provider_accepted"].includes(String(r.outreach?.status || ""))).length,
    opened: rows.filter(r => r.engagement.opened).length,
    uploadAttempted: rows.filter(r => r.engagement.attemptedUpload).length,
    complete: rows.filter(r => r.engagement.packageComplete).length
  };

  return { unauthorized: false, counts, rows };
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
  router.get("/staff/rehash", async (req, res) => {
    try {
      const snapshot = await staffRehashSnapshot(req);
      if (snapshot.unauthorized) return res.status(403).set("Cache-Control", "no-store").json({ ok: false, error: "SIERRA_ADMIN_REQUIRED" });
      return res.set("Cache-Control", "no-store").json({ ok: true, ...snapshot });
    } catch (error) {
      return res.status(503).set("Cache-Control", "no-store").json({ ok: false, error: error instanceof Error ? error.message : "REHASH_STAFF_UNAVAILABLE" });
    }
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
