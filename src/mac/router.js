import express from "express";
import crypto from "crypto";
import { claimMacJobs, completeMacJob } from "./queue.js";

const heartbeats = new Map();

function tokenMatches(value) {
  const expected = Buffer.from(String(process.env.GEORGIE_MAC_AGENT_TOKEN || ""));
  const actual = Buffer.from(String(value || ""));
  return expected.length > 20 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function requireAgent(req, res, next) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!tokenMatches(token)) return res.status(401).json({ ok: false, error: "Unauthorized Mac agent" });
  next();
}

export function getMacDeviceStatus() {
  const now = Date.now();
  return [...heartbeats.entries()].map(([deviceId, info]) => ({
    deviceId,
    ...info,
    online: now - new Date(info.lastSeenAt).getTime() < 30000
  }));
}

export function createMacRouter() {
  const router = express.Router();
  router.use(requireAgent);

  router.post("/:deviceId/heartbeat", (req, res) => {
    const deviceId = String(req.params.deviceId).slice(0, 160);
    heartbeats.set(deviceId, {
      hostname: String(req.body?.hostname || "").slice(0, 160),
      platform: String(req.body?.platform || "macOS").slice(0, 50),
      arch: String(req.body?.arch || "").slice(0, 50),
      lastSeenAt: new Date().toISOString()
    });
    res.json({ ok: true, serverTime: new Date().toISOString() });
  });

  router.get("/:deviceId/jobs", async (req, res) => {
    try {
      const jobs = await claimMacJobs(String(req.params.deviceId), Number(req.query?.limit || 5));
      res.json({ ok: true, jobs });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Could not claim Mac jobs" });
    }
  });

  router.post("/:deviceId/jobs/:jobId/complete", async (req, res) => {
    try {
      const job = await completeMacJob(String(req.params.deviceId), String(req.params.jobId), {
        result: req.body?.result ?? null,
        error: req.body?.error ?? null
      });
      res.status(job ? 200 : 404).json({ ok: Boolean(job), job });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Could not complete Mac job" });
    }
  });

  return router;
}
