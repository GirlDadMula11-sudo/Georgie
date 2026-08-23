import crypto from "crypto";
import express from "express";
import { buildCommandCenter, createApprovalRequest, decideApproval, listApprovals, listDecisions, recordDecision } from "./command-layer.js";
import { authenticateNativeRequest } from "./mobile-auth.js";
import { executeInfrastructureAdmin, infrastructureAdminCapabilities } from "./integrations/infrastructure-admin.js";

function userId() { return String(process.env.GEORGIE_PRIMARY_USER_ID || "primary").slice(0, 100); }
function requireControlAuth(req, res, next) {
  const expected = String(process.env.GEORGIE_COMMAND_CONTROL_TOKEN || "");
  if (!expected) return res.status(503).json({ ok: false, error: "Secure command-control writes are not activated", executionTriggered: false });
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (!supplied || suppliedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(suppliedBytes, expectedBytes)) return res.status(401).json({ ok: false, error: "Secure command-control authorization required", executionTriggered: false });
  next();
}

export function createCommandRouter() {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      const device = await authenticateNativeRequest(req);
      if (!device) return res.status(401).json({ ok: false, error: "Secure Georgie device authentication required", executionTriggered: false });
      req.commandDevice = device;
      next();
    } catch (error) { res.status(503).json({ ok: false, error: "Secure command-center authentication unavailable", executionTriggered: false }); }
  });
  router.get("/", async (req, res) => { try { res.json({ ok: true, commandCenter: await buildCommandCenter(userId(req), { refreshSierra: req.query?.refresh === "true" }) }); } catch (error) { res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Command center unavailable" }); } });
  router.get("/decisions", async (req, res) => { try { res.json({ ok: true, decisions: await listDecisions(userId(req), { limit: req.query?.limit, domain: req.query?.domain || "all" }) }); } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Decision journal unavailable" }); } });
  router.post("/decisions", requireControlAuth, async (req, res) => { try { res.status(201).json({ ok: true, decision: await recordDecision(userId(req), req.body || {}) }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Decision could not be recorded" }); } });
  router.get("/approvals", async (req, res) => { try { res.json({ ok: true, approvals: await listApprovals(userId(req), { status: req.query?.status || "pending", limit: req.query?.limit }) }); } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Approval control unavailable" }); } });
  router.post("/approvals", requireControlAuth, async (req, res) => { try { res.status(201).json({ ok: true, approval: await createApprovalRequest(userId(req), req.body || {}) }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Approval request could not be created" }); } });
  router.post("/approvals/:id/decision", requireControlAuth, async (req, res) => { try { const approval = await decideApproval(userId(req), req.params.id, req.body || {}); res.status(approval ? 200 : 404).json({ ok: Boolean(approval), approval, executionTriggered: false }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Approval decision failed", executionTriggered: false }); } });
  router.get("/infrastructure-admin/capabilities", async (_req, res) => { res.json({ ok: true, infrastructureAdmin: infrastructureAdminCapabilities() }); });
  router.post("/infrastructure-admin/execute", requireControlAuth, async (req, res) => {
    try {
      const result = await executeInfrastructureAdmin(userId(req), req.body || {});
      res.status(200).json(result);
    } catch (error) {
      const status = Number(error?.status) || 400;
      res.status(status >= 400 && status < 600 ? status : 400).json({ ok: false, error: error instanceof Error ? error.message : "Infrastructure administration failed", code: error?.code || null, provider: error?.providerPayload || null, executionTriggered: false });
    }
  });
  return router;
}
