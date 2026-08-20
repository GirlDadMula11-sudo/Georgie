import crypto from "node:crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";

const NS = "action_journal";
const SENSITIVE_KEY = /token|key|secret|password|authorization|ssn|ein|dob|body|text|html|content|clipboard/i;
function safeArgs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, child]) => {
    if (SENSITIVE_KEY.test(key)) return [key, "[redacted]"];
    if (child === null || ["boolean", "number"].includes(typeof child)) return [key, child];
    if (typeof child === "string") return [key, child.slice(0, 160)];
    return [key, Array.isArray(child) ? `[array:${child.length}]` : "[object]"];
  }));
}

export async function recordAction(userId, input = {}) {
  const uid = String(userId || "primary");
  const state = await readCloudState(uid, NS, { entries: [] });
  const entries = Array.isArray(state.entries) ? state.entries : [];
  const entry = {
    id: crypto.randomUUID(), userId: uid,
    tool: String(input.tool || "unknown").slice(0, 160),
    risk: String(input.risk || "unknown").slice(0, 80),
    status: String(input.status || "unknown").slice(0, 80),
    approvalRequired: Boolean(input.approvalRequired),
    argsSummary: safeArgs(input.argsSummary),
    error: input.error ? String(input.error).slice(0, 1200) : null,
    startedAt: input.startedAt || new Date().toISOString(), completedAt: new Date().toISOString()
  };
  entries.push(entry);
  await writeCloudState(uid, NS, { entries: entries.slice(-5000), updatedAt: entry.completedAt });
  return entry;
}

export async function listActionJournal(userId, { limit = 50 } = {}) {
  const state = await readCloudState(String(userId || "primary"), NS, { entries: [] });
  return (Array.isArray(state.entries) ? state.entries : []).slice(-Math.max(1, Math.min(Number(limit) || 50, 200))).reverse();
}
