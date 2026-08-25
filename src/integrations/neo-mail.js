import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { createOutboundBoundary } from "../master-closer.js";
import { readCloudState, writeCloudState } from "../cloud-state.js";

const DEFAULT_IMAP_HOST = process.env.GEORGIE_NEO_IMAP_HOST || "imap0001.neo.space";
const DEFAULT_IMAP_PORT = Number(process.env.GEORGIE_NEO_IMAP_PORT || 993);
const DEFAULT_SMTP_HOST = process.env.GEORGIE_NEO_SMTP_HOST || "smtp0001.neo.space";
const DEFAULT_SMTP_PORT = Number(process.env.GEORGIE_NEO_SMTP_PORT || 465);
const HUMAN_ESCALATION_DISCLOSURE = "If you would prefer to speak with a person directly, you can contact Sierra Capital Advisory CEO Jason Sierra or Louri Brown.";
const BUSINESS_ROLES = new Set(["executive_work", "lender_submissions", "georgie_closer", "client_correspondence"]);

function dedicatedMailboxes() {
  const defs = [
    {
      id: "closer",
      email: process.env.GEORGIE_NEO_CLOSER_EMAIL,
      password: process.env.GEORGIE_NEO_CLOSER_PASSWORD,
      label: "Georgie Closer",
      role: "georgie_closer"
    },
    {
      id: "work",
      email: process.env.GEORGIE_NEO_WORK_EMAIL,
      password: process.env.GEORGIE_NEO_WORK_PASSWORD,
      label: "Sierra Work",
      role: "executive_work"
    },
    {
      id: "submissions",
      email: process.env.GEORGIE_NEO_SUBMISSIONS_EMAIL,
      password: process.env.GEORGIE_NEO_SUBMISSIONS_PASSWORD,
      label: "Sierra Submissions",
      role: "lender_submissions"
    }
  ];
  return defs.filter((item) => item.email && item.password);
}

function parseMailboxes() {
  const dedicated = dedicatedMailboxes();
  const raw = process.env.GEORGIE_NEO_MAILBOXES_JSON;
  let parsed = [];
  if (raw) {
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("GEORGIE_NEO_MAILBOXES_JSON must be valid JSON"); }
    if (!Array.isArray(parsed)) throw new Error("GEORGIE_NEO_MAILBOXES_JSON must be an array");
  }

  const combined = [...dedicated, ...parsed]
    .filter((item) => item && item.id && item.email && item.password)
    .map((item) => ({
      id: String(item.id).slice(0, 80),
      email: String(item.email).trim(),
      password: String(item.password),
      label: String(item.label || item.email).slice(0, 120),
      role: String(item.role || "general").slice(0, 80),
      imapHost: String(item.imapHost || DEFAULT_IMAP_HOST),
      imapPort: Number(item.imapPort || DEFAULT_IMAP_PORT),
      smtpHost: String(item.smtpHost || DEFAULT_SMTP_HOST),
      smtpPort: Number(item.smtpPort || DEFAULT_SMTP_PORT)
    }));

  const seen = new Set();
  return combined.filter((item) => {
    const key = item.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicMailbox(mailbox) {
  return { id: mailbox.id, email: mailbox.email, label: mailbox.label, role: mailbox.role };
}

function getMailbox(id) {
  const mailboxes = parseMailboxes();
  const mailbox = mailboxes.find((item) => item.id === id || item.email.toLowerCase() === String(id || "").toLowerCase());
  if (!mailbox) throw new Error(`Neo mailbox is not configured: ${id}`);
  return mailbox;
}

function makeImap(mailbox) {
  return new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: true,
    auth: { user: mailbox.email, pass: mailbox.password },
    logger: false
  });
}

function makeSmtp(mailbox) {
  return nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.smtpPort === 465,
    requireTLS: mailbox.smtpPort !== 465,
    auth: { user: mailbox.email, pass: mailbox.password }
  });
}

function normalizeAddress(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value.value)) return value.value.map((item) => item.address).filter(Boolean).join(", ");
  return "";
}

function insertDisclosureBeforeSignature(text) {
  const source = String(text || "");
  if (!source || source.includes(HUMAN_ESCALATION_DISCLOSURE)) return source;
  const disclosure = `\n\n${HUMAN_ESCALATION_DISCLOSURE}\n`;
  const signature = /\n\s*(Best(?: regards)?|Regards|Sincerely|Thank you|Thanks|Respectfully|Warmly|Georgie)\s*,?\s*\n/i;
  const match = signature.exec(source);
  if (!match) return `${source.trimEnd()}${disclosure}`;
  return `${source.slice(0, match.index).trimEnd()}${disclosure}${source.slice(match.index)}`;
}

function insertHtmlDisclosureBeforeSignature(html) {
  const source = String(html || "");
  if (!source || source.includes(HUMAN_ESCALATION_DISCLOSURE)) return source;
  const disclosure = `<p>${HUMAN_ESCALATION_DISCLOSURE}</p>`;
  const signature = /<(p|div)[^>]*>\s*(Best(?: regards)?|Regards|Sincerely|Thank you|Thanks|Respectfully|Warmly|Georgie)\b/i;
  const match = signature.exec(source);
  if (!match) return `${source}${disclosure}`;
  return `${source.slice(0, match.index)}${disclosure}${source.slice(match.index)}`;
}

async function parseMessage(id, uid, { markSeen = false, includeAttachmentContent = false } = {}) {
  const mailbox = getMailbox(id);
  const imap = makeImap(mailbox);
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const message = await imap.fetchOne(String(uid), { source: true, uid: true, flags: true }, { uid: true });
      if (!message?.source) throw new Error("Message not found");
      const parsed = await simpleParser(message.source);
      if (markSeen) await imap.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      return {
        mailboxId: mailbox.id,
        uid: message.uid,
        subject: parsed.subject || "",
        from: parsed.from?.text || "",
        to: parsed.to?.text || "",
        cc: parsed.cc?.text || "",
        date: parsed.date?.toISOString?.() || null,
        messageId: parsed.messageId || "",
        text: String(parsed.text || "").slice(0, 30000),
        html: typeof parsed.html === "string" ? parsed.html.slice(0, 50000) : "",
        attachments: (parsed.attachments || []).map((file) => ({
          filename: file.filename || "attachment",
          contentType: file.contentType,
          size: file.size,
          ...(includeAttachmentContent ? { content: file.content } : {})
        }))
      };
    } finally { lock.release(); }
  } finally { await imap.logout().catch(() => {}); }
}

export function listNeoMailboxes() { return parseMailboxes().map(publicMailbox); }
export function neoMailConfigured() { return parseMailboxes().length > 0; }
export function selectGeorgieCorrespondenceMailbox() {
  const mailboxes = parseMailboxes();
  return publicMailbox(mailboxes.find((item) => item.role === "georgie_closer" || item.id === "closer") || mailboxes.find((item) => item.role === "executive_work" || item.id === "work") || mailboxes[0]);
}
export const neoHumanEscalationDisclosure = HUMAN_ESCALATION_DISCLOSURE;
export const neoMailInternals = { insertDisclosureBeforeSignature, insertHtmlDisclosureBeforeSignature };

export async function verifyNeoMailbox(id) {
  const mailbox = getMailbox(id);
  const imap = makeImap(mailbox);
  try {
    await imap.connect();
    await imap.mailboxOpen("INBOX", { readOnly: true });
  } finally {
    await imap.logout().catch(() => {});
  }
  await makeSmtp(mailbox).verify();
  return { ok: true, mailbox: publicMailbox(mailbox) };
}

export async function listRecentMessages(id, { limit = 20, unseenOnly = false } = {}) {
  const mailbox = getMailbox(id);
  const imap = makeImap(mailbox);
  const items = [];
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const exists = imap.mailbox?.exists || 0;
      if (!exists) return [];
      const start = Math.max(1, exists - Math.max(1, Math.min(Number(limit) || 20, 100)) + 1);
      for await (const msg of imap.fetch(`${start}:*`, { uid: true, envelope: true, flags: true, internalDate: true })) {
        const seen = msg.flags?.has("\\Seen") || false;
        if (unseenOnly && seen) continue;
        items.push({ mailboxId: mailbox.id, uid: msg.uid, subject: msg.envelope?.subject || "", from: normalizeAddress(msg.envelope?.from), to: normalizeAddress(msg.envelope?.to), date: msg.internalDate?.toISOString?.() || null, seen });
      }
    } finally { lock.release(); }
  } finally { await imap.logout().catch(() => {}); }
  return items.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);
}

export async function listMessagesBefore(id, { beforeUid = null, limit = 100 } = {}) {
  const mailbox = getMailbox(id);
  const imap = makeImap(mailbox);
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
  try {
    await imap.connect();
    await imap.mailboxOpen("INBOX", { readOnly: true });
    const allUids = await imap.search({ all: true }, { uid: true });
    const ceiling = beforeUid == null ? Number.POSITIVE_INFINITY : Number(beforeUid);
    const selected = allUids.filter(uid => Number(uid) < ceiling).slice(-boundedLimit);
    const items = [];
    if (!selected.length) return { mailbox: publicMailbox(mailbox), messages: [], nextBeforeUid: null, exhausted: true };
    for await (const msg of imap.fetch(selected, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true })) {
      items.push({ mailboxId: mailbox.id, uid: msg.uid, subject: msg.envelope?.subject || "", from: normalizeAddress(msg.envelope?.from), to: normalizeAddress(msg.envelope?.to), date: msg.internalDate?.toISOString?.() || null, seen: msg.flags?.has("\\Seen") || false });
    }
    items.sort((a, b) => Number(b.uid) - Number(a.uid));
    const nextBeforeUid = Math.min(...selected.map(Number));
    return { mailbox: publicMailbox(mailbox), messages: items, nextBeforeUid, exhausted: allUids.filter(uid => Number(uid) < nextBeforeUid).length === 0 };
  } finally { await imap.logout().catch(() => {}); }
}

export async function readMessage(id, uid, { markSeen = false } = {}) {
  return parseMessage(id, uid, { markSeen, includeAttachmentContent: false });
}

export async function readMessageForProcessing(id, uid) {
  return parseMessage(id, uid, { markSeen: false, includeAttachmentContent: true });
}

const outboundAudit = async (event) => {
  const userId = process.env.GEORGIE_PRIMARY_USER_ID || "primary";
  const state = await readCloudState(userId, "outbound_correspondence_audit", { events: [] });
  state.events = [...(Array.isArray(state.events) ? state.events : []), event].slice(-10000);
  await writeCloudState(userId, "outbound_correspondence_audit", state);
};
const outboundLookup = async (idempotencyKey) => {
  const userId = process.env.GEORGIE_PRIMARY_USER_ID || "primary";
  const state = await readCloudState(userId, "outbound_correspondence_audit", { events: [] });
  return [...(Array.isArray(state.events) ? state.events : [])].reverse().find((event) => event.idempotencyKey === idempotencyKey) || null;
};
const governedSend = createOutboundBoundary({ audit: outboundAudit, lookup: outboundLookup, deliver: async ({ mailbox, to, cc, bcc, subject, text, html, replyTo, attachments = [] }) => {
  const result = await makeSmtp(mailbox).sendMail({ from: mailbox.email, to, cc, bcc, subject: String(subject || "").slice(0, 998), text, html, replyTo, attachments: Array.isArray(attachments) ? attachments : [] });
  return { messageId: result.messageId, accepted: result.accepted, rejected: result.rejected };
} });

export async function sendMessage(id, { to, cc, bcc, subject, text, html, replyTo, attachments = [], idempotencyKey, correlationId, dealId, threadId, audience, rationale, evidenceState, escalation }) {
  const mailbox = getMailbox(id);
  if (!to) throw new Error("Recipient is required");
  const result = await governedSend({ mailbox, to, cc, bcc, subject, text, html, replyTo, attachments, idempotencyKey, correlationId, dealId, threadId, audience, rationale, evidenceState, escalation });
  return { mailboxId: mailbox.id, from: mailbox.email, role: mailbox.role, to, subject: subject || "", ...result.provider, deduplicated: result.deduplicated, idempotencyKey: result.idempotencyKey, humanEscalationDisclosureApplied: true };
}

export async function searchMessages(id, { query = "", limit = 25 } = {}) {
  const mailbox = getMailbox(id);
  const imap = makeImap(mailbox);
  const normalized = String(query || "").trim();
  try {
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const search = normalized ? { or: [{ subject: normalized }, { body: normalized }, { from: normalized }, { to: normalized }] } : { all: true };
      const uids = await imap.search(search, { uid: true });
      const selected = uids.slice(-Math.max(1, Math.min(Number(limit) || 25, 100)));
      const items = [];
      if (!selected.length) return items;
      for await (const msg of imap.fetch(selected, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true })) {
        items.push({ mailboxId: mailbox.id, uid: msg.uid, subject: msg.envelope?.subject || "", from: normalizeAddress(msg.envelope?.from), to: normalizeAddress(msg.envelope?.to), date: msg.internalDate?.toISOString?.() || null, seen: msg.flags?.has("\\Seen") || false });
      }
      return items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    } finally { lock.release(); }
  } finally { await imap.logout().catch(() => {}); }
}
