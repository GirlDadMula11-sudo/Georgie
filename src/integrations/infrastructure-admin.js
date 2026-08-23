import crypto from "node:crypto";
import { recordAction } from "../action-journal.js";

const VERCEL_BASE = "https://api.vercel.com";
const SUPABASE_BASE = "https://api.supabase.com";
const SENSITIVE = /token|secret|password|authorization|cookie|invite.?code|key|credential/i;
const WRITE_ACTIONS = new Set([
  "vercel.team.member.invite",
  "vercel.team.member.remove",
  "supabase.organization.member.invite"
]);
const ALLOWED = new Set([
  "vercel.team.members.list",
  "vercel.team.member.invite",
  "vercel.team.member.remove",
  "supabase.organization.members.list",
  "supabase.organization.roles.list",
  "supabase.organization.member.invite"
]);

function timeout(ms = 8000) { return AbortSignal.timeout(Math.max(1000, Math.min(Number(ms) || 8000, 20000))); }
function clean(value, max = 240) { return String(value ?? "").trim().slice(0, max); }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 320)); }
function idempotencyKey(input = {}) {
  const stable = JSON.stringify({ provider: input.provider, action: input.action, tenant: input.tenant, resource: input.resource, subject: input.subject, role: input.role });
  return clean(input.idempotencyKey, 160) || crypto.createHash("sha256").update(stable).digest("hex");
}

export function redactProviderPayload(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactProviderPayload(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 500) : value;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, child]) => [key, SENSITIVE.test(key) ? "[redacted]" : redactProviderPayload(child, depth + 1)]));
}

async function providerFetch(url, token, options = {}) {
  if (!token) throw new Error("Provider admin credential is not configured");
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: options.signal || timeout(options.timeoutMs)
  });
  const text = await response.text().catch(() => "");
  let payload = null;
  if (text) { try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 800) }; } }
  if (!response.ok) {
    const error = new Error(`Provider admin request failed (${response.status})`);
    error.status = response.status;
    error.providerPayload = redactProviderPayload(payload);
    throw error;
  }
  return redactProviderPayload(payload);
}

function normalizeCommand(input = {}) {
  const action = clean(input.action, 120);
  if (!ALLOWED.has(action)) throw new Error("Infrastructure-admin action is not allowlisted");
  const write = WRITE_ACTIONS.has(action);
  if (write && process.env.GEORGIE_INFRA_ADMIN_WRITES_ENABLED !== "true") throw new Error("Infrastructure-admin writes are disabled");
  if (write && input.approved !== true) throw new Error("Explicit approval is required for infrastructure-admin writes");
  if (write && !clean(input.approvalId, 160)) throw new Error("Approved infrastructure-admin writes require an approvalId");
  return {
    action,
    write,
    provider: action.split(".")[0],
    tenant: clean(input.tenant || input.teamId || input.organizationSlug, 200),
    resource: clean(input.resource || input.projectId, 200),
    subject: clean(input.subject || input.email || input.uid, 320),
    role: clean(input.role, 80).toUpperCase(),
    approvalId: clean(input.approvalId, 160),
    requester: clean(input.requester || "primary", 120),
    idempotencyKey: idempotencyKey(input)
  };
}

export function infrastructureAdminCapabilities() {
  return {
    configured: {
      vercel: Boolean(process.env.GEORGIE_VERCEL_TOKEN && process.env.GEORGIE_VERCEL_TEAM_ID),
      supabaseManagement: Boolean(process.env.GEORGIE_SUPABASE_MANAGEMENT_TOKEN)
    },
    writesEnabled: process.env.GEORGIE_INFRA_ADMIN_WRITES_ENABLED === "true",
    operations: [...ALLOWED],
    defaultDeny: true,
    explicitApprovalForWrites: true,
    rawCredentialsModelVisible: false,
    billingAndOwnershipWrites: false,
    projectDeletion: false,
    destructiveDatabaseAdmin: false
  };
}

async function executeVercel(command) {
  const token = process.env.GEORGIE_VERCEL_TOKEN;
  const teamId = command.tenant || process.env.GEORGIE_VERCEL_TEAM_ID;
  if (!teamId) throw new Error("Vercel team is not configured");
  if (command.action === "vercel.team.members.list") {
    return providerFetch(`${VERCEL_BASE}/v3/teams/${encodeURIComponent(teamId)}/members?limit=100`, token);
  }
  if (command.action === "vercel.team.member.invite") {
    if (!isEmail(command.subject)) throw new Error("A valid member email is required");
    const role = command.role || "MEMBER";
    if (!["MEMBER", "DEVELOPER", "VIEWER", "CONTRIBUTOR"].includes(role)) throw new Error("Requested Vercel role is outside the allowlist");
    return providerFetch(`${VERCEL_BASE}/v1/teams/${encodeURIComponent(teamId)}/members`, token, {
      method: "POST",
      body: JSON.stringify({ email: command.subject, role })
    });
  }
  if (command.action === "vercel.team.member.remove") {
    if (!/^[A-Za-z0-9_-]{6,100}$/.test(command.subject)) throw new Error("A valid Vercel member uid is required");
    return providerFetch(`${VERCEL_BASE}/v1/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(command.subject)}`, token, { method: "DELETE" });
  }
  throw new Error("Unsupported Vercel admin action");
}

async function executeSupabase(command) {
  const token = process.env.GEORGIE_SUPABASE_MANAGEMENT_TOKEN;
  const slug = command.tenant || process.env.GEORGIE_SUPABASE_ORGANIZATION_SLUG;
  if (!slug) throw new Error("Supabase organization is not configured");
  if (command.action === "supabase.organization.members.list") {
    return providerFetch(`${SUPABASE_BASE}/v1/organizations/${encodeURIComponent(slug)}/members`, token);
  }
  if (command.action === "supabase.organization.roles.list") {
    return providerFetch(`${SUPABASE_BASE}/v2/organizations/${encodeURIComponent(slug)}/roles`, token);
  }
  if (command.action === "supabase.organization.member.invite") {
    if (!isEmail(command.subject)) throw new Error("A valid member email is required");
    const endpoint = clean(process.env.GEORGIE_SUPABASE_MEMBER_INVITE_ENDPOINT, 500);
    if (!endpoint) {
      const error = new Error("Supabase member invitation is not API-enabled for this deployment; governed dashboard fallback is required");
      error.code = "SUPABASE_DASHBOARD_FALLBACK_REQUIRED";
      throw error;
    }
    const url = endpoint.replace("{slug}", encodeURIComponent(slug));
    if (!url.startsWith(`${SUPABASE_BASE}/`)) throw new Error("Supabase invitation endpoint must remain on api.supabase.com");
    const role = (command.role || "DEVELOPER").toLowerCase();
    if (!["developer", "read_only", "administrator"].includes(role)) throw new Error("Requested Supabase role is outside the allowlist");
    return providerFetch(url, token, { method: "POST", body: JSON.stringify({ email: command.subject, role }) });
  }
  throw new Error("Unsupported Supabase admin action");
}

export async function executeInfrastructureAdmin(userId, input = {}) {
  const command = normalizeCommand(input);
  const startedAt = new Date().toISOString();
  try {
    const result = command.provider === "vercel" ? await executeVercel(command) : await executeSupabase(command);
    await recordAction(userId, {
      tool: `infrastructure_admin.${command.action}`,
      risk: command.write ? "high" : "low",
      status: "completed",
      approvalRequired: command.write,
      startedAt,
      argsSummary: { tenant: command.tenant, resource: command.resource, subject: command.subject, role: command.role, approvalId: command.approvalId, idempotencyKey: command.idempotencyKey }
    });
    return { ok: true, action: command.action, idempotencyKey: command.idempotencyKey, result, verifiedAt: new Date().toISOString() };
  } catch (error) {
    await recordAction(userId, {
      tool: `infrastructure_admin.${command.action}`,
      risk: command.write ? "high" : "low",
      status: "failed",
      approvalRequired: command.write,
      startedAt,
      argsSummary: { tenant: command.tenant, resource: command.resource, subject: command.subject, role: command.role, approvalId: command.approvalId, idempotencyKey: command.idempotencyKey },
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => {});
    throw error;
  }
}
