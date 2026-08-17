import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { readCloudState, writeCloudState, cloudStateStatus } from "../cloud-state.js";

const NS = "mac_jobs";
const PRIMARY = () => process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const DATA_DIR = () => path.resolve(process.env.GEORGIE_DATA_DIR || "data", "mac-jobs");

function safeUserId(userId) {
  return String(userId || PRIMARY()).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "primary";
}

function localPath(userId) {
  return path.join(DATA_DIR(), `${safeUserId(userId)}.json`);
}

async function readLocalStore(userId) {
  try {
    const raw = await fs.readFile(localPath(userId), "utf8");
    const parsed = JSON.parse(raw);
    return { jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : [] };
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Mac job local read failed:", error instanceof Error ? error.message : error);
    return { jobs: [] };
  }
}

async function writeLocalStore(userId, store) {
  await fs.mkdir(DATA_DIR(), { recursive: true, mode: 0o700 });
  const target = localPath(userId);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ jobs: Array.isArray(store?.jobs) ? store.jobs : [] }), { mode: 0o600 });
  await fs.rename(temp, target);
}

function mergeStores(localStore, cloudStore) {
  const byId = new Map();
  for (const job of [...(cloudStore?.jobs || []), ...(localStore?.jobs || [])]) {
    if (job?.id) byId.set(job.id, job);
  }
  return { jobs: [...byId.values()].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))).slice(-5000) };
}

async function readStore(userId = PRIMARY()) {
  const uid = safeUserId(userId);
  const local = await readLocalStore(uid);
  if (!cloudStateStatus().enabled) return local;
  const cloud = await readCloudState(uid, NS, { jobs: [] });
  const merged = mergeStores(local, cloud);
  if (merged.jobs.length !== local.jobs.length) await writeLocalStore(uid, merged).catch(() => {});
  return merged;
}

async function writeStore(userId, store) {
  const uid = safeUserId(userId);
  await writeLocalStore(uid, store);
  if (cloudStateStatus().enabled) {
    const mirrored = await writeCloudState(uid, NS, store);
    if (!mirrored) console.warn("Mac job cloud mirror unavailable; durable local queue remains active.");
  }
}

export async function enqueueMacJob({ userId, deviceId, action, args = {}, risk = "low_risk_write", reason = "" }) {
  const uid = safeUserId(userId || PRIMARY());
  const store = await readStore(uid);
  const job = {
    id: crypto.randomUUID(), userId: uid, deviceId, action, args, risk, reason,
    status: "queued", createdAt: new Date().toISOString(), claimedAt: null,
    completedAt: null, result: null, error: null
  };
  store.jobs.push(job);
  store.jobs = store.jobs.slice(-5000);
  await writeStore(uid, store);
  return job;
}

export async function claimMacJobs(deviceId, limit = 5) {
  const uid = safeUserId(PRIMARY());
  const store = await readStore(uid);
  const jobs = store.jobs.filter(j => j.deviceId === deviceId && j.status === "queued").slice(0, limit);
  const now = new Date().toISOString();
  for (const job of jobs) { job.status = "claimed"; job.claimedAt = now; }
  if (jobs.length) await writeStore(uid, store);
  return jobs;
}

export async function completeMacJob(deviceId, jobId, { result = null, error = null } = {}) {
  const uid = safeUserId(PRIMARY());
  const store = await readStore(uid);
  const job = store.jobs.find(j => j.id === jobId && j.deviceId === deviceId);
  if (!job) return null;
  job.status = error ? "failed" : "completed";
  job.completedAt = new Date().toISOString();
  job.result = result;
  job.error = error;
  await writeStore(uid, store);
  return job;
}

export async function listMacJobs(userId, limit = 50) {
  const uid = safeUserId(userId || PRIMARY());
  const store = await readStore(uid);
  return store.jobs.filter(j => j.userId === uid).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}
