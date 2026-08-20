import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readCloudState, writeCloudState } from "./cloud-state.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const USER = () => process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const NS = "jason_operating_model";

function mailboxDefs() {
  return [
    { id: "work", email: process.env.GEORGIE_NEO_WORK_EMAIL, password: process.env.GEORGIE_NEO_WORK_PASSWORD },
    { id: "submissions", email: process.env.GEORGIE_NEO_SUBMISSIONS_EMAIL, password: process.env.GEORGIE_NEO_SUBMISSIONS_PASSWORD }
  ].filter((x) => x.email && x.password);
}

async function callModel(instructions, input) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_BALANCED_MODEL || "gpt-5.6-terra",
      instructions,
      input,
      reasoning: { effort: "medium", context: "all_turns" },
      text: { verbosity: "low" }
    }),
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`Operating-model analysis failed (${response.status})`);
  const payload = await response.json();
  const text = payload.output_text || (payload.output || []).flatMap((i) => i.content || []).find((c) => c.type === "output_text")?.text || "";
  return String(text).trim();
}

async function sentFolder(client) {
  const boxes = await client.list();
  const special = boxes.find((b) => b.specialUse === "\\Sent");
  if (special?.path) return special.path;
  const likely = boxes.find((b) => /(^|\/)(sent|sent items|sent messages)$/i.test(String(b.path || "")));
  return likely?.path || null;
}

async function sampleSent(mailbox, limit = 80) {
  const client = new ImapFlow({
    host: process.env.GEORGIE_NEO_IMAP_HOST || "imap0001.neo.space",
    port: Number(process.env.GEORGIE_NEO_IMAP_PORT || 993),
    secure: true,
    auth: { user: mailbox.email, pass: mailbox.password },
    logger: false
  });
  const samples = [];
  try {
    await client.connect();
    const folder = await sentFolder(client);
    if (!folder) return { mailbox: mailbox.id, folder: null, samples: [] };
    const lock = await client.getMailboxLock(folder);
    try {
      const exists = client.mailbox?.exists || 0;
      if (!exists) return { mailbox: mailbox.id, folder, samples: [] };
      const start = Math.max(1, exists - Math.max(1, Math.min(limit, 200)) + 1);
      for await (const msg of client.fetch(`${start}:*`, { uid: true, source: true, envelope: true, internalDate: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        samples.push({
          uid: msg.uid,
          date: msg.internalDate?.toISOString?.() || parsed.date?.toISOString?.() || null,
          to: parsed.to?.text || "",
          cc: parsed.cc?.text || "",
          subject: parsed.subject || "",
          text: String(parsed.text || "").slice(0, 5000)
        });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return { mailbox: mailbox.id, samples: samples.slice(-limit) };
}

function redactForLearning(samples) {
  return samples.map((m) => ({ date: m.date, to: m.to, cc: m.cc, subject: m.subject, text: m.text }));
}

export async function buildEmailOperatingModel() {
  if (process.env.GEORGIE_EMAIL_LEARNING_ENABLED !== "true") return { ok: false, skipped: "disabled" };
  const defs = mailboxDefs();
  if (!defs.length) return { ok: false, skipped: "neo_not_configured" };

  const prior = await readCloudState(USER(), NS, {});
  const sampled = await Promise.all(defs.map((m) => sampleSent(m, Number(process.env.GEORGIE_EMAIL_LEARNING_SAMPLE || 80))));
  const total = sampled.reduce((n, x) => n + x.samples.length, 0);
  if (!total) return { ok: false, skipped: "no_sent_mail_found" };

  const evidence = sampled.map((x) => ({ mailbox: x.mailbox, messages: redactForLearning(x.samples) }));
  const analysis = await callModel(
    `You are building a behavior model for Sierra's owner from his own historical sent business email. This is observation only. Do not draft or send mail. Infer stable patterns, not isolated quirks. Separate lender, partner, client, internal, and vendor communication when evidence supports it. Identify tone, brevity, negotiation style, follow-up timing, information-request patterns, escalation behavior, decision style, preferred wording, boundary-setting, and recurring operational heuristics. Note uncertainty. Never infer sensitive personal attributes. Return concise JSON only with keys: communication_style, audience_playbooks, negotiation_patterns, followup_patterns, information_request_patterns, escalation_patterns, decision_patterns, preferred_phrasing, avoid_phrasing, operating_heuristics, confidence, evidence_count.`,
    JSON.stringify({ priorModel: prior?.model || null, evidence })
  );

  let model;
  try { model = JSON.parse(analysis.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()); }
  catch { model = { summary: analysis, confidence: 0.5, evidence_count: total }; }

  const state = {
    mode: "observe_only",
    model,
    sampledMessages: total,
    mailboxCounts: Object.fromEntries(sampled.map((x) => [x.mailbox, x.samples.length])),
    lastLearnedAt: new Date().toISOString(),
    authorityLevel: "observe",
    canSend: false,
    canAutoReply: false
  };
  await writeCloudState(USER(), NS, state);
  console.log(`[Georgie] Email operating model learned: ${JSON.stringify({ ok: true, sampledMessages: total, mailboxCounts: state.mailboxCounts, authorityLevel: state.authorityLevel })}`);
  return { ok: true, ...state };
}
