import crypto from "node:crypto";
import { enforceHumanAccessHtml } from "./master-closer.js";

const SIERRA_URL = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const SIERRA_KEY = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
const SMARTLEAD_BASE = String(process.env.GEORGIE_SMARTLEAD_BASE_URL || "https://server.smartlead.ai/api/v1").replace(/\/$/, "");
const SMARTLEAD_KEY = String(process.env.GEORGIE_SMARTLEAD_API_KEY || "").trim();
const WORKER_ID = "georgie-smartlead-reply-closer-v1";
const POLL_MS = Math.max(15_000, Number(process.env.GEORGIE_SMARTLEAD_REPLY_POLL_MS || 30_000));
const AUTO_CLASSES = new Set(["partner_interest", "interested", "follow_up_later", "call_request"]);
let timer = null;
let running = false;

function configured() { return Boolean(SIERRA_URL && SIERRA_KEY && SMARTLEAD_KEY); }
function clean(v, max = 5000) { return String(v ?? "").trim().slice(0, max); }
function esc(v) { return clean(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function idem(id) { return `smartlead-reply:${id}:v1`; }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function headers(extra = {}) { return { apikey: SIERRA_KEY, authorization: `Bearer ${SIERRA_KEY}`, ...extra }; }

async function rpc(name, body = {}) {
  const response = await fetch(`${SIERRA_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify(body), signal: AbortSignal.timeout(12_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed (${response.status}): ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function db(path, init = {}) {
  const response = await fetch(`${SIERRA_URL}/rest/v1/${path}`, {
    ...init, headers: headers({ "content-type": "application/json", ...(init.headers || {}) }), signal: init.signal || AbortSignal.timeout(12_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sierra REST ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function smartlead(path, { method = "GET", body } = {}) {
  const join = path.includes("?") ? "&" : "?";
  const response = await fetch(`${SMARTLEAD_BASE}${path}${join}api_key=${encodeURIComponent(SMARTLEAD_KEY)}`, {
    method,
    headers: body ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });
  const text = await response.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`Smartlead ${method} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  return payload;
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "messages", "results", "leads"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

async function resolveLeadId(job) {
  const result = await smartlead(`/leads/?email=${encodeURIComponent(job.lead_email)}`);
  const candidates = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : result?.id ? [result] : [];
  const direct = candidates.find(x => String(x?.email || "").toLowerCase() === String(job.lead_email || "").toLowerCase()) || candidates[0];
  const leadId = direct?.id ?? direct?.lead_id;
  if (!leadId) throw new Error("SMARTLEAD_LEAD_ID_UNRESOLVED");
  return String(leadId);
}

function replyHtml(job) {
  const disclosure = clean(job.required_disclosure || "You can also speak directly with CEO Jason Sierra or Louri Brown.", 500);
  const firstName = esc(job.contact_name || "").split(/\s+/)[0] || "there";
  let html;
  if (job.reply_class === "partner_interest") {
    html = `<p>Hi ${firstName},</p><p>Absolutely. Sierra acts as the commercial-capital desk behind referral partners. When one of your clients has a financing need, you can introduce the opportunity and our team handles the capital process from intake through underwriting, financing strategy, lender placement, lender communication, offers, and execution through funding.</p><p>The goal is to give you a strong financing resource without requiring you to build an internal lending operation, while keeping you connected to the relationship. We can evaluate working capital, lines of credit, equipment, commercial real estate, and other business-capital needs and determine the most appropriate path for each file.</p><p>If it makes sense, we can do a short introductory conversation, or you can send over a first opportunity and we can show you the process on a live deal.</p><p>${esc(disclosure)}</p><p>Best,<br>Georgie<br>Sierra Capital Advisory</p>`;
  } else if (job.reply_class === "follow_up_later") {
    html = `<p>Hi ${firstName},</p><p>You mentioned reconnecting after your return, so I wanted to follow up at the time you requested.</p><p>I’d be glad to walk through how Sierra can support your clients when a commercial financing need comes up. What day and time works best for a brief conversation?</p><p>${esc(disclosure)}</p><p>Best,<br>Georgie<br>Sierra Capital Advisory</p>`;
  } else if (job.reply_class === "call_request") {
    html = `<p>Hi ${firstName},</p><p>Absolutely. We’d be glad to connect and walk through it directly. Send over a day and time that works well for you and we’ll coordinate the conversation.</p><p>${esc(disclosure)}</p><p>Best,<br>Georgie<br>Sierra Capital Advisory</p>`;
  } else {
    html = `<p>Hi ${firstName},</p><p>Thanks for the reply. I can help clarify how Sierra works and the best next step based on what you’re looking to accomplish.</p><p>If you tell me what type of opportunity or financing need you have in mind, I’ll point you in the right direction without making you repeat information we already have.</p><p>${esc(disclosure)}</p><p>Best,<br>Georgie<br>Sierra Capital Advisory</p>`;
  }
  return enforceHumanAccessHtml(html);
}

async function reserve(job) {
  const key = idem(job.obligation_id);
  const existing = await db(`smartlead_reply_delivery_receipts?idempotency_key=eq.${encodeURIComponent(key)}&select=id,provider_message_id,accepted,metadata`);
  if (Array.isArray(existing) && existing.length) return { key, existing: existing[0] };
  const rows = await db("smartlead_reply_delivery_receipts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      obligation_id: job.obligation_id,
      idempotency_key: key,
      provider_message_id: `reserved:${job.obligation_id}`,
      sender_mailbox: job.sender_mailbox,
      recipient_email: job.lead_email,
      subject: job.subject,
      accepted: false,
      rejected: [],
      metadata: { stage: "reserved", worker: WORKER_ID, transport: "smartlead_thread", reply_class: job.reply_class, thread_preservation_required: true }
    })
  });
  return { key, existing: Array.isArray(rows) ? rows[0] : null };
}

async function messageHistory(job, leadId) {
  const payload = await smartlead(`/campaigns/${job.provider_campaign_id}/leads/${leadId}/message-history?show_plain_text_response=true`);
  return unwrapRows(payload);
}

function messageIdOf(m) { return clean(m?.message_id ?? m?.id ?? m?.email_id, 500); }
function messageTimeOf(m) { return m?.sent_at ?? m?.email_time ?? m?.created_at ?? m?.timestamp ?? m?.time ?? m?.date ?? null; }
function typeOf(m) { return String(m?.type ?? m?.message_type ?? m?.email_type ?? m?.event_type ?? m?.direction ?? "").toUpperCase(); }

async function findSentReceipt(job, leadId, notBefore) {
  const messages = await messageHistory(job, leadId);
  const cutoff = Date.parse(notBefore || 0) - 120_000;
  const sent = messages
    .filter(m => /SENT|OUTBOUND/.test(typeOf(m)) && messageTimeOf(m) && Date.parse(messageTimeOf(m)) >= cutoff)
    .sort((a, b) => Date.parse(messageTimeOf(b)) - Date.parse(messageTimeOf(a)));
  return sent[0] ? { providerMessageId: messageIdOf(sent[0]), message: sent[0] } : null;
}

async function markProviderAccepted(job, key, providerResponse) {
  const at = new Date().toISOString();
  await db(`smartlead_reply_delivery_receipts?idempotency_key=eq.${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ metadata: { stage: "provider_accepted_waiting_message_id", worker: WORKER_ID, transport: "smartlead_thread", provider_response: providerResponse, thread_preservation_required: true } })
  });
  await db(`smartlead_reply_obligations?id=eq.${encodeURIComponent(job.obligation_id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ response_status: "queued", lease_expires_at: null, updated_at: at, metadata: { ...(job.metadata || {}), provider_send_accepted: true, provider_send_accepted_at: at, send_reservation: key, send_authority: "georgie_runtime", transport: "smartlead_thread" } })
  });
  return at;
}

async function complete(job, key, providerMessageId, providerResponse, receiptSource) {
  return rpc("complete_smartlead_reply_closer_work", {
    p_obligation_id: job.obligation_id,
    p_worker_id: WORKER_ID,
    p_idempotency_key: key,
    p_provider_message_id: providerMessageId,
    p_sender_mailbox: job.sender_mailbox,
    p_subject: job.subject,
    p_accepted: true,
    p_rejected: [],
    p_metadata: { provider: "smartlead", provider_response: providerResponse, receipt_source: receiptSource, worker: WORKER_ID, transport: "smartlead_thread", thread_preserved: true, human_access_disclosure: true }
  });
}

async function fail(job, error) {
  try { return await rpc("fail_smartlead_reply_closer_work", { p_obligation_id: job.obligation_id, p_worker_id: WORKER_ID, p_error: clean(error?.message || error, 1000) }); }
  catch { return null; }
}

async function enrichJob(job) {
  const rows = await db(`smartlead_reply_obligations?id=eq.${encodeURIComponent(job.obligation_id)}&select=*,outreach_contacts(contact_name)`);
  const full = Array.isArray(rows) ? rows[0] : null;
  return full ? { ...job, ...full, contact_name: full.outreach_contacts?.contact_name || "", required_disclosure: full.metadata?.required_disclosure || job.required_disclosure } : job;
}

async function reconcileAccepted(limit = 10) {
  const rows = await db(`smartlead_reply_obligations?response_status=eq.queued&metadata->>provider_send_accepted=eq.true&select=*&limit=${Math.max(1, Math.min(limit, 20))}`);
  for (const row of rows || []) {
    try {
      const job = { ...row, obligation_id: row.id };
      const leadId = await resolveLeadId(job);
      const acceptedAt = row.metadata?.provider_send_accepted_at || row.updated_at;
      const receipt = await findSentReceipt(job, leadId, acceptedAt);
      if (!receipt?.providerMessageId) continue;
      await complete({ ...job, worker_id: WORKER_ID }, row.metadata?.send_reservation || idem(row.id), receipt.providerMessageId, { reconciled: true }, "message_history");
      console.log("SMARTLEAD_REPLY_CLOSER_RECEIPT", JSON.stringify({ obligationId: row.id, providerMessageId: receipt.providerMessageId }));
    } catch (error) {
      console.error("SMARTLEAD_REPLY_CLOSER_RECEIPT_ERROR", clean(error?.message || error, 500));
    }
  }
}

export async function runSmartleadReplyCloserOnce() {
  if (!configured()) return { ok: false, skipped: true, reason: "not_configured" };
  if (running) return { ok: true, skipped: true, reason: "already_running" };
  running = true;
  try {
    await reconcileAccepted(10);
    const claim = await rpc("claim_smartlead_reply_closer_work", { p_worker_id: WORKER_ID, p_limit: 5, p_lease_seconds: 300 });
    const jobs = Array.isArray(claim?.jobs) ? claim.jobs : [];
    const results = [];
    for (const raw of jobs) {
      const job = await enrichJob(raw);
      try {
        if (!AUTO_CLASSES.has(job.reply_class) || job.requires_human_review || !job.auto_response_allowed) {
          await fail(job, "AUTO_SEND_POLICY_BLOCK");
          results.push({ obligationId: job.obligation_id, status: "blocked" });
          continue;
        }
        if (!job.provider_campaign_id || !job.provider_message_id || !job.lead_email) throw new Error("THREAD_CONTEXT_INCOMPLETE");
        const leadId = await resolveLeadId(job);
        const reservation = await reserve(job);
        if (reservation.existing) {
          // Never send again from a pre-existing reservation. Reconcile provider truth instead.
          const receipt = await findSentReceipt(job, leadId, job.metadata?.provider_send_accepted_at || job.updated_at || job.created_at);
          if (receipt?.providerMessageId) {
            await complete({ ...job, worker_id: WORKER_ID }, reservation.key, receipt.providerMessageId, { reconciled: true }, "message_history_existing_reservation");
            results.push({ obligationId: job.obligation_id, status: "reconciled", providerMessageId: receipt.providerMessageId });
          } else {
            await fail(job, "AMBIGUOUS_EXISTING_SEND_RESERVATION_NO_RETRY");
            results.push({ obligationId: job.obligation_id, status: "human_review_required" });
          }
          continue;
        }
        const html = replyHtml(job);
        const replyTime = job.metadata?.provider_occurred_at || job.created_at || new Date().toISOString();
        const sendStartedAt = new Date().toISOString();
        const providerResponse = await smartlead(`/campaigns/${job.provider_campaign_id}/reply-email-thread`, {
          method: "POST",
          body: {
            lead_id: Number(leadId),
            email_body: html,
            reply_message_id: job.provider_message_id,
            reply_email_time: replyTime
          }
        });
        const acceptedAt = await markProviderAccepted(job, reservation.key, providerResponse);
        await new Promise(resolve => setTimeout(resolve, 1500));
        const immediateId = clean(providerResponse?.message_id ?? providerResponse?.data?.message_id ?? providerResponse?.id, 500);
        const receipt = immediateId ? { providerMessageId: immediateId } : await findSentReceipt(job, leadId, sendStartedAt || acceptedAt);
        if (receipt?.providerMessageId) {
          await complete({ ...job, worker_id: WORKER_ID }, reservation.key, receipt.providerMessageId, providerResponse, immediateId ? "reply_api" : "message_history");
          results.push({ obligationId: job.obligation_id, status: "sent", providerMessageId: receipt.providerMessageId });
        } else {
          results.push({ obligationId: job.obligation_id, status: "provider_accepted_waiting_receipt" });
        }
      } catch (error) {
        // If provider acceptance is unknown after a send attempt, fail closed. No blind retry.
        await fail(job, error);
        results.push({ obligationId: job.obligation_id, status: "failed_closed", error: clean(error?.message || error, 300) });
      }
    }
    return { ok: true, worker: WORKER_ID, jobs: results };
  } finally { running = false; }
}

export function startSmartleadReplyCloserWorker() {
  if (timer || !configured()) {
    if (!configured()) console.warn("Smartlead reply closer worker not started: Sierra/Smartlead runtime configuration missing");
    return;
  }
  const tick = () => runSmartleadReplyCloserOnce().catch(error => console.error("SMARTLEAD_REPLY_CLOSER_ERROR", clean(error?.stack || error, 1200)));
  setTimeout(tick, 5_000).unref?.();
  timer = setInterval(tick, POLL_MS);
  timer.unref?.();
  console.log(`Georgie Smartlead threaded reply closer worker online (${POLL_MS}ms)`);
}

export const smartleadReplyCloserWorkerContract = Object.freeze({
  version: "georgie.smartlead-reply-closer.v1",
  workerId: WORKER_ID,
  transport: "smartlead_reply_email_thread",
  threadPreservationRequired: true,
  blindRetryAfterAmbiguousSend: false,
  autoClasses: [...AUTO_CLASSES],
  providerReceiptRequired: true,
  humanAccessDisclosureRequired: true,
  idempotency: "one durable reservation per obligation"
});
