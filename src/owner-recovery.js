import crypto from "node:crypto";
import { createEnrollmentCode } from "./mobile-auth.js";
import { sendMessage } from "./integrations/neo-mail.js";

const PER_CLIENT_WINDOW_MS = 15 * 60 * 1000;
const PER_CLIENT_LIMIT = 2;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_LIMIT = 5;
const clientAttempts = new Map();
const activeRecoveries = new Map();
let globalAttempts = [];

function nowMs() { return Date.now(); }
function prune(values, windowMs, at = nowMs()) { return values.filter(value => at - value < windowMs); }
function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "configured owner email";
  return `${local.slice(0, 2)}***@${domain}`;
}
function recoveryEmail() {
  return String(process.env.GEORGIE_OWNER_RECOVERY_EMAIL || process.env.GEORGIE_NEO_WORK_EMAIL || "").trim();
}
function recoveryMailbox() {
  return String(process.env.GEORGIE_OWNER_RECOVERY_MAILBOX || "work").trim() || "work";
}
function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
export function recoveryDeliveryKey({ to, code, expiresAt }) {
  return `georgie-owner-recovery:v1:${digest(`${String(to).trim().toLowerCase()}\n${String(expiresAt)}\n${String(code)}`)}`;
}
function activeRecoveryKey(clientKey, to) {
  return digest(`${String(clientKey || "unknown").slice(0, 200)}\n${String(to).trim().toLowerCase()}`);
}
function rateLimit(clientKey) {
  const at = nowMs();
  const key = String(clientKey || "unknown").slice(0, 200);
  const current = prune(clientAttempts.get(key) || [], PER_CLIENT_WINDOW_MS, at);
  globalAttempts = prune(globalAttempts, GLOBAL_WINDOW_MS, at);
  if (current.length >= PER_CLIENT_LIMIT || globalAttempts.length >= GLOBAL_LIMIT) {
    const error = new Error("Recovery request limit reached. Try again later.");
    error.code = "rate_limited";
    throw error;
  }
  current.push(at);
  globalAttempts.push(at);
  clientAttempts.set(key, current);
}

export function ownerRecoveryConfigured() {
  return Boolean(recoveryEmail());
}

export async function requestOwnerRecovery({ clientKey = "unknown" } = {}) {
  const to = recoveryEmail();
  if (!to) {
    const error = new Error("Owner recovery email is not configured");
    error.code = "recovery_not_configured";
    throw error;
  }
  const requestKey = activeRecoveryKey(clientKey, to);
  const active = activeRecoveries.get(requestKey);
  if (active && active.expiresAtMs > nowMs()) return active.promise;
  if (active) activeRecoveries.delete(requestKey);

  rateLimit(clientKey);
  const work = (async () => {
    const enrollment = await createEnrollmentCode({ ttlMinutes: 15 });
    const idempotencyKey = recoveryDeliveryKey({ to, code: enrollment.code, expiresAt: enrollment.expiresAt });
    await sendMessage(recoveryMailbox(), {
      to,
      subject: "Georgie device recovery code",
      text: [
        "A Georgie device recovery code was requested.",
        "",
        `Recovery code: ${enrollment.code}`,
        `Expires: ${enrollment.expiresAt}`,
        "",
        "Use this code only on the Georgie enrollment screen. If you did not request it, ignore this message."
      ].join("\n"),
      idempotencyKey,
      correlationId: idempotencyKey,
      audience: "owner_device_recovery",
      rationale: "Deliver a user-requested, short-lived Georgie device enrollment code to the configured owner mailbox.",
      evidenceState: {
        claims: [],
        requestType: "owner_device_recovery",
        destinationConfigured: true,
        expiresAt: enrollment.expiresAt
      }
    });
    return { delivery: "owner_email", destination: maskEmail(to), expiresAt: enrollment.expiresAt };
  })();
  activeRecoveries.set(requestKey, { promise: work, expiresAtMs: nowMs() + PER_CLIENT_WINDOW_MS });
  try {
    return await work;
  } catch (error) {
    if (activeRecoveries.get(requestKey)?.promise === work) activeRecoveries.delete(requestKey);
    throw error;
  }
}

export function resetOwnerRecoveryRateLimitForTests() {
  clientAttempts.clear();
  activeRecoveries.clear();
  globalAttempts = [];
}
