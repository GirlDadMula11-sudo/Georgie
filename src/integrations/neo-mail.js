import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

const DEFAULT_IMAP_HOST = process.env.GEORGIE_NEO_IMAP_HOST || "imap0001.neo.space";
const DEFAULT_IMAP_PORT = Number(process.env.GEORGIE_NEO_IMAP_PORT || 993);
const DEFAULT_SMTP_HOST = process.env.GEORGIE_NEO_SMTP_HOST || "smtp0001.neo.space";
const DEFAULT_SMTP_PORT = Number(process.env.GEORGIE_NEO_SMTP_PORT || 465);

function parseMailboxes() {
  const raw = process.env.GEORGIE_NEO_MAILBOXES_JSON;
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("GEORGIE_NEO_MAILBOXES_JSON must be valid JSON"); }
  if (!Array.isArray(parsed)) throw new Error("GEORGIE_NEO_MAILBOXES_JSON must be an array");
  return parsed
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

export function listNeoMailboxes() { return parseMailboxes().map(publicMailbox); }
export function neoMailConfigured() { return parseMailboxes().length > 0; }

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

export async function readMessage(id, uid, { markSeen = false } = {}) {
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
        attachments: (parsed.attachments || []).map((file) => ({ filename: file.filename || "attachment", contentType: file.contentType, size: file.size }))
      };
    } finally { lock.release(); }
  } finally { await imap.logout().catch(() => {}); }
}

export async function sendMessage(id, { to, cc, bcc, subject, text, html, replyTo, attachments = [] }) {
  const mailbox = getMailbox(id);
  if (!to) throw new Error("Recipient is required");
  const result = await makeSmtp(mailbox).sendMail({
    from: mailbox.email,
    to,
    cc,
    bcc,
    subject: String(subject || "").slice(0, 998),
    text: text ? String(text) : undefined,
    html: html ? String(html) : undefined,
    replyTo,
    attachments: Array.isArray(attachments) ? attachments : []
  });
  return { mailboxId: mailbox.id, from: mailbox.email, to, subject: subject || "", messageId: result.messageId, accepted: result.accepted, rejected: result.rejected };
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
