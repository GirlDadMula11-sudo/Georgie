import express from "express";
import crypto from "node:crypto";
import { ingestRecoveryCandidate, ingestSuppressionEvent, receiveRecoveryReply } from "./financing-recovery.js";
import { supabaseRecoveryStore } from "./financing-recovery-worker.js";

function authorized(req) {
  const expected = String(process.env.GEORGIE_FINANCING_RECOVERY_INGEST_TOKEN || "");
  const actual = String(req.get("x-georgie-recovery-token") || "");
  if (!expected || expected.length < 32 || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function createFinancingRecoveryRouter({ store = supabaseRecoveryStore() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => authorized(req) ? next() : res.status(401).json({ ok: false, error: "RECOVERY_INGEST_AUTH_REQUIRED" }));
  const route = handler => async (req, res) => {
    try { res.status(202).json({ ok: true, result: await handler(store, req.body || {}) }); }
    catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "RECOVERY_INGEST_REJECTED" }); }
  };
  router.post("/intake", route(ingestRecoveryCandidate));
  router.post("/reply", route(receiveRecoveryReply));
  router.post("/suppression", route(ingestSuppressionEvent));
  return router;
}
