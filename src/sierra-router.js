import express from "express";
import {
  getSierraDeal,
  getSierraHealth,
  getSierraLenderResponses,
  getSierraOffers,
  getSierraPortfolio,
  queueSierraAction,
  sierraWorkforceConfigured
} from "./integrations/sierra-workforce.js";

function clean(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

export function createSierraRouter() {
  const router = express.Router();

  router.get("/status", (_req, res) => {
    res.json({ ok: true, configured: sierraWorkforceConfigured() });
  });

  router.get("/portfolio", async (req, res) => {
    try {
      const deals = await getSierraPortfolio(req.georgieUserId || "primary", { limit: Number(req.query?.limit || 25) });
      res.json({ ok: true, deals });
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Sierra portfolio unavailable" });
    }
  });

  router.get("/health", async (req, res) => {
    try {
      res.json({ ok: true, health: await getSierraHealth(req.georgieUserId || "primary") });
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Sierra health unavailable" });
    }
  });

  router.get("/deal/:reference", async (req, res) => {
    try {
      const reference = clean(req.params.reference, 100);
      const deal = await getSierraDeal(req.georgieUserId || "primary", reference);
      if (!deal || !Object.keys(deal).length) return res.status(404).json({ ok: false, error: "Deal not found" });
      res.json({ ok: true, deal });
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Sierra deal unavailable" });
    }
  });

  router.get("/deal/:reference/lenders", async (req, res) => {
    try {
      res.json({ ok: true, lenders: await getSierraLenderResponses(req.georgieUserId || "primary", clean(req.params.reference, 100)) });
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Sierra lender data unavailable" });
    }
  });

  router.get("/deal/:reference/offers", async (req, res) => {
    try {
      res.json({ ok: true, offers: await getSierraOffers(req.georgieUserId || "primary", clean(req.params.reference, 100)) });
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Sierra offers unavailable" });
    }
  });

  router.post("/deal/:reference/action", async (req, res) => {
    try {
      const action = clean(req.body?.action, 80);
      if (!["refresh_pipeline"].includes(action)) {
        return res.status(403).json({ ok: false, approvalRequired: true, error: "External Sierra actions must run through Georgie's governed tool approval flow" });
      }
      const result = await queueSierraAction(req.georgieUserId || "primary", {
        reference: clean(req.params.reference, 100),
        action,
        reason: clean(req.body?.reason, 1200)
      });
      res.json({ ok: true, result });
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Sierra action unavailable" });
    }
  });

  return router;
}
