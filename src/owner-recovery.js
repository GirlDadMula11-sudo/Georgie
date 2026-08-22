import { createEnrollmentCode } from "./mobile-auth.js";
import { sendMessage } from "./integrations/neo-mail.js";

const PER_CLIENT_WINDOW_MS = 15 * 60 * 1000;
const PER_CLIENT_LIMIT = 2;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_LIMIT = 5;
const clientAttempts = new Map();
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
  rateLimit(clientKey);
  const to = recoveryEmail();
  if (!to) {
    const error = new Error("Owner recovery email is not configured");
    error.code = "recovery_not_configured";
    throw error;
  }
  const enrollment = await createEnrollmentCode({ ttlMinutes: 15 });
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
    ].join("\n")
  });
  return { delivery: "owner_email", destination: maskEmail(to), expiresAt: enrollment.expiresAt };
}

export function resetOwnerRecoveryRateLimitForTests() {
  clientAttempts.clear();
  globalAttempts = [];
}
