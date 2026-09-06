import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { canonicalJson } from "./native-hardware-profile.js";

const SHA256 = /^[a-f0-9]{64}$/;
const TERMINAL_FILE = /^(campaign|failure)-([a-f0-9]{64})\.json$/;
const CANDIDATE_FILE = /^([a-z0-9._-]+)-([a-f0-9]{64})\.json$/;

export const N2_QUALIFICATION_STATUS_SCHEMA = "sierra.n2-qualification-status.v1";
export const DEFAULT_N2_QUALIFICATION_ROOT = path.join(os.homedir(), "Library", "Application Support", "Georgie", "N2-Qualification", "v1");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function bounded(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function intOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function digestOrNull(value) {
  const digest = String(value || "").trim().toLowerCase();
  return SHA256.test(digest) ? digest : null;
}

function candidateSummary(result = {}) {
  const evidence = result?.evidence && typeof result.evidence === "object" ? result.evidence : {};
  return Object.freeze({
    candidateId: bounded(result?.candidateId, 100) || null,
    receiptSha256: digestOrNull(result?.receiptSha256),
    coldStartMs: finiteOrNull(evidence.coldStartMs),
    restartReadyMs: finiteOrNull(evidence.restartReadyMs),
    semanticCases: intOrNull(evidence.semanticCases),
    semanticPassed: intOrNull(evidence.semanticPassed),
    semanticPassRate: finiteOrNull(evidence.semanticPassRate),
    stressRequests: intOrNull(evidence.stressRequests),
    stressErrors: intOrNull(evidence.stressErrors),
    stressErrorRate: finiteOrNull(evidence.stressErrorRate),
    p50TotalMs: finiteOrNull(evidence.p50TotalMs),
    p95TotalMs: finiteOrNull(evidence.p95TotalMs),
    peakRssBytes: intOrNull(evidence.peakRssBytes),
    postRestartRssBytes: intOrNull(evidence.postRestartRssBytes),
    forcedCrashRestarts: intOrNull(evidence.forcedCrashRestarts),
    crashRecoverySucceeded: evidence.crashRecoverySucceeded === true,
  });
}

function sanitizeCampaign(payload = {}, filenameDigest) {
  if (payload?.schema !== "sierra.n2-real-host-qualification-campaign.v1") throw new Error("N2_STATUS_CAMPAIGN_SCHEMA_REJECTED");
  if (payload?.promotionAuthority !== "none") throw new Error("N2_STATUS_PROMOTION_AUTHORITY_REJECTED");
  const embedded = digestOrNull(payload?.campaignSha256);
  if (!embedded || embedded !== filenameDigest) throw new Error("N2_STATUS_CAMPAIGN_FILENAME_HASH_MISMATCH");
  const body = { ...payload };
  delete body.campaignSha256;
  if (sha256(canonicalJson(body)) !== embedded) throw new Error("N2_STATUS_CAMPAIGN_CANONICAL_HASH_MISMATCH");
  const results = Array.isArray(payload.results) ? payload.results.map(candidateSummary) : [];
  return Object.freeze({
    status: "completed",
    campaignSha256: embedded,
    startedAt: bounded(payload.startedAt, 40) || null,
    completedAt: bounded(payload.completedAt, 40) || null,
    hostHardwareFingerprintSha256: digestOrNull(payload.hostHardwareFingerprintSha256),
    hostRuntimeFingerprintSha256: digestOrNull(payload.hostRuntimeFingerprintSha256),
    matrixSha256: digestOrNull(payload.matrixSha256),
    engineCommit: bounded(payload.engineCommit, 80) || null,
    engineBinarySha256: digestOrNull(payload.engineBinarySha256),
    candidates: results,
    promotionAuthority: "none",
    nextGate: bounded(payload.nextGate, 120) || null,
  });
}

function sanitizeFailure(payload = {}, filenameDigest) {
  if (payload?.schema !== "sierra.n2-real-host-qualification-failure.v1") throw new Error("N2_STATUS_FAILURE_SCHEMA_REJECTED");
  if (payload?.promotionAuthority !== "none") throw new Error("N2_STATUS_PROMOTION_AUTHORITY_REJECTED");
  const embedded = digestOrNull(payload?.failureSha256);
  if (!embedded || embedded !== filenameDigest) throw new Error("N2_STATUS_FAILURE_FILENAME_HASH_MISMATCH");
  const body = { ...payload };
  delete body.failureSha256;
  if (sha256(canonicalJson(body)) !== embedded) throw new Error("N2_STATUS_FAILURE_CANONICAL_HASH_MISMATCH");
  return Object.freeze({
    status: "failed",
    failureSha256: embedded,
    failedAt: bounded(payload.failedAt, 40) || null,
    hostHardwareFingerprintSha256: digestOrNull(payload.hostHardwareFingerprintSha256),
    code: bounded(payload.code, 120) || "n2_qualification_failed",
    message: bounded(payload.message, 500),
    promotionAuthority: "none",
  });
}

async function readJson(file, fsImpl) {
  const raw = await fsImpl.readFile(file, "utf8");
  if (raw.length > 2_000_000) throw new Error("N2_STATUS_RECEIPT_TOO_LARGE");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("N2_STATUS_RECEIPT_INVALID");
  return parsed;
}

async function processAlive(pid, signal = process.kill) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    signal(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function assertRoot(root) {
  const expected = path.resolve(DEFAULT_N2_QUALIFICATION_ROOT);
  const resolved = path.resolve(root);
  if (resolved !== expected) throw new Error("N2_STATUS_ROOT_REJECTED");
  return resolved;
}

export async function readN2QualificationStatus(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const root = assertRoot(options.root || DEFAULT_N2_QUALIFICATION_ROOT);
  const receipts = path.join(root, "receipts");
  let names = [];
  try {
    names = await fsImpl.readdir(receipts);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const terminals = names.map((name) => ({ name, match: name.match(TERMINAL_FILE) })).filter((item) => item.match);
  const terminalRows = [];
  for (const item of terminals) {
    const stat = await fsImpl.stat(path.join(receipts, item.name));
    terminalRows.push({ ...item, mtimeMs: Number(stat.mtimeMs || 0) });
  }
  terminalRows.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));

  if (terminalRows.length) {
    const selected = terminalRows[0];
    const payload = await readJson(path.join(receipts, selected.name), fsImpl);
    const projection = selected.match[1] === "campaign"
      ? sanitizeCampaign(payload, selected.match[2])
      : sanitizeFailure(payload, selected.match[2]);
    const body = { schema: N2_QUALIFICATION_STATUS_SCHEMA, ...projection, observedAt: new Date().toISOString() };
    return Object.freeze({ ...body, projectionSha256: sha256(canonicalJson(body)) });
  }

  const lockFile = path.join(root, "campaign-launch.lock.json");
  try {
    const lock = await readJson(lockFile, fsImpl);
    const pid = Number(lock?.pid);
    const alive = await processAlive(pid, options.processSignal || process.kill);
    const status = alive ? "running" : "stale_lock";
    const body = {
      schema: N2_QUALIFICATION_STATUS_SCHEMA,
      status,
      launchedAt: bounded(lock?.launchedAt, 40) || null,
      hostHardwareFingerprintSha256: digestOrNull(lock?.hostHardwareFingerprintSha256),
      promotionAuthority: "none",
      observedAt: new Date().toISOString(),
    };
    return Object.freeze({ ...body, projectionSha256: sha256(canonicalJson(body)) });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const candidateReceipts = names.filter((name) => CANDIDATE_FILE.test(name)).length;
  const body = {
    schema: N2_QUALIFICATION_STATUS_SCHEMA,
    status: candidateReceipts ? "incomplete_without_terminal_receipt" : "not_started",
    candidateReceiptCount: candidateReceipts,
    promotionAuthority: "none",
    observedAt: new Date().toISOString(),
  };
  return Object.freeze({ ...body, projectionSha256: sha256(canonicalJson(body)) });
}
