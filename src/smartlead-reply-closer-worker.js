import { specialistExecutionPermit } from "./resource-governor.js";
import { randomUUID } from "node:crypto";
import { enforceHumanAccessHtml } from "./master-closer.js";
import { evaluateSmartleadWebhookThreadFallback } from "./smartlead-reply-fallback-evidence.js";
import { nextReplyCloserSchedule } from "./smartlead-reply-backpressure.js";

const SIERRA_URL = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const SIERRA_KEY = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
const SMARTLEAD_BASE = String(process.env.GEORGIE_SMARTLEAD_BASE_URL || "https://server.smartlead.ai/api/v1").replace(/\/$/, "");
const SMARTLEAD_KEY = String(process.env.GEORGIE_SMARTLEAD_API_KEY || "").trim();
const WORKER_ID = "georgie-smartlead-reply-closer-v1";
const WORKER_VERSION = "georgie.smartlead-reply-closer.v2.5.2";
const INSTANCE_ID = String(process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || randomUUID()).slice(0, 200);
const ACTIVE_POLL_MS = Math.max(15_000, Number(process.env.GEORGIE_SMARTLEAD_REPLY_POLL_MS || 30_000));
const IDLE_POLL_MS = Math.max(ACTIVE_POLL_MS, Number(process.env.GEORGIE_SMARTLEAD_REPLY_IDLE_POLL_MS || 60_000));
const MAX_BACKOFF_MS = Math.max(IDLE_POLL_MS, Number(process.env.GEORGIE_SMARTLEAD_REPLY_MAX_BACKOFF_MS || 180_000));
const AUTO_CLASSES = new Set(["partner_interest", "interested", "follow_up_later", "call_request"]);
let timer = null;
let authorityRetryTimer = null;
let running = false;
let authorityGeneration = null;
let authorityStale = false;

function configured() { return Boolean(SIERRA_URL && SIERRA_KEY && SMARTLEAD_KEY); }
function clean(v, max = 5000) { return String(v ?? "").trim().slice(0, max); }
function esc(v) { return clean(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function idem(id) { return `smartlead-reply:${id}:v1`; }
function headers(extra = {}) { return { apikey: SIERRA_KEY, authorization: `Bearer ${SIERRA_KEY}`, ...extra }; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isStaleAuthorityError(error) { return /SMARTLEAD_REPLY_CLOSER_STALE_GENERATION|LEGACY_CLAIM_DISABLED|LEGACY_HEARTBEAT_DISABLED/i.test(String(error?.message || error)); }

async function rpc(name, body = {}, timeoutMs = 10_000) {
  const response = await fetch(`${SIERRA_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed (${response.status}): ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function db(path, init = {}) {
  const response = await fetch(`${SIERRA_URL}/rest/v1/${path}`, { ...init, headers: headers({ "content-type": "application/json", ...(init.headers || {}) }), signal: init.signal || AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sierra REST ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function activateAuthority() {
  if (authorityGeneration != null || authorityStale) return authorityGeneration;
  const result = await rpc("activate_smartlead_reply_closer_authority", { p_worker_id: WORKER_ID, p_worker_version: WORKER_VERSION, p_instance_id: INSTANCE_ID }, 8000);
  authorityGeneration = Number(result?.generation);
  if (!Number.isFinite(authorityGeneration)) throw new Error("SMARTLEAD_REPLY_CLOSER_AUTHORITY_GENERATION_MISSING");
  console.log("SMARTLEAD_REPLY_CLOSER_AUTHORITY", JSON.stringify({ worker: WORKER_ID, version: WORKER_VERSION, instance: INSTANCE_ID, generation: authorityGeneration }));
  return authorityGeneration;
}

async function assertAuthority() {
  if (authorityGeneration == null || authorityStale) throw new Error("SMARTLEAD_REPLY_CLOSER_STALE_GENERATION");
  try { return await rpc("assert_smartlead_reply_closer_authority", { p_worker_id: WORKER_ID, p_worker_version: WORKER_VERSION, p_instance_id: INSTANCE_ID, p_generation: authorityGeneration }, 5000); }
  catch (error) { if (isStaleAuthorityError(error)) authorityStale = true; throw error; }
}

async function releaseStaleClaim(job) {
  try { return await rpc("release_smartlead_reply_closer_claim", { p_obligation_id: job.obligation_id, p_worker_id: WORKER_ID, p_generation: authorityGeneration }, 5000); }
  catch { return null; }
}

async function heartbeat(phase, { ok = true, error = null, result = {} } = {}) {
  if (authorityGeneration == null || authorityStale) return;
  try { await rpc("record_smartlead_reply_closer_heartbeat_v2", { p_worker_id: WORKER_ID, p_worker_version: WORKER_VERSION, p_instance_id: INSTANCE_ID, p_generation: authorityGeneration, p_phase: phase, p_ok: ok, p_error: error ? clean(error?.message || error, 1800) : null, p_result: result || {} }, 5000); }
  catch (e) { if (isStaleAuthorityError(e)) authorityStale = true; console.error("SMARTLEAD_REPLY_CLOSER_HEARTBEAT_ERROR", clean(e?.message || e, 400)); }
}

async function smartleadRequest(path, { method = "GET", body, timeoutMs = 9000 } = {}) {
  const join = path.includes("?") ? "&" : "?";
  const response = await fetch(`${SMARTLEAD_BASE}${path}${join}api_key=${encodeURIComponent(SMARTLEAD_KEY)}`, { method, headers: body ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 1000) }; }
  if (!response.ok) throw new Error(`Smartlead ${method} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
  return payload;
}

async function smartleadRead(path) {
  let lastError;
  for (const timeoutMs of [6500, 10_000]) {
    try { return await smartleadRequest(path, { method: "GET", timeoutMs }); }
    catch (error) { lastError = error; if (!/timeout|aborted|429|5\d\d/i.test(String(error?.message || error))) throw error; await sleep(250); }
  }
  throw lastError || new Error("SMARTLEAD_READ_FAILED");
}

async function smartleadWrite(path, body) { await assertAuthority(); return smartleadRequest(path, { method: "POST", body, timeoutMs: 15_000 }); }
function unwrapRows(payload) { if (Array.isArray(payload)) return payload; for (const key of ["data", "messages", "results", "leads", "history", "email_history"]) if (Array.isArray(payload?.[key])) return payload[key]; return []; }

async function resolveLeadId(job) {
  const immutable = clean(job.provider_lead_id || job.metadata?.provider_lead_id, 80);
  if (immutable && /^\d+$/.test(immutable)) return immutable;
  const providerEmail = clean(job.provider_lead_email || job.metadata?.provider_lead_email || job.lead_email, 500).toLowerCase();
  const result = await smartleadRead(`/leads/?email=${encodeURIComponent(providerEmail)}`);
  const candidates = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : result?.id ? [result] : [];
  const direct = candidates.find(x => String(x?.email || "").toLowerCase() === providerEmail) || candidates[0];
  const leadId = direct?.id ?? direct?.lead_id;
  if (!leadId) throw new Error(`SMARTLEAD_LEAD_ID_UNRESOLVED:${providerEmail}`);
  return String(leadId);
}

async function verifySenderMailbox(job) {
  if (!job.sender_mailbox) throw new Error("ORIGINAL_SENDER_MAILBOX_MISSING");
  const payload = await smartleadRead(`/campaigns/${job.provider_campaign_id}/email-accounts`);
  const rows = unwrapRows(payload);
  if (!rows.length) throw new Error("SMARTLEAD_SENDER_ACCOUNT_EVIDENCE_MISSING");
  const expected = String(job.sender_mailbox).trim().toLowerCase();
  const emails = rows.map(row => String(row?.from_email ?? row?.email ?? row?.email_address ?? "").trim().toLowerCase()).filter(Boolean);
  if (!emails.includes(expected)) throw new Error(`ORIGINAL_SENDER_NOT_ASSIGNED_TO_CAMPAIGN:${expected}`);
  return { expected, assigned: true, accountCount: rows.length };
}

function replyAgeHours(job) { const raw = job.metadata?.provider_occurred_at || job.created_at; const time = Date.parse(raw || ""); return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 3600000) : 0; }
function replyHtml(job) {
  const disclosure = clean(job.required_disclosure || "You can also speak directly with CEO Jason Sierra or Louri Brown.", 500);
  const firstName = esc(job.contact_name || "").split(/\s+/)[0] || "there";
  const delayed = replyAgeHours(job) >= 24 ? "<p>Thanks for your patience — I’m following up on your earlier message.</p>" : "";
  let html;
  if (job.reply_class === "partner_interest") html = `<p>Hi ${firstName},</p>${delayed}<p>Absolutely. Sierra acts as the commercial-capital desk behind referral partners. When one of your clients has a financing need, you can introduce the opportunity and our team handles the capital process from intake through underwriting, financing strategy, lender placement, lender communication, offers, and execution through funding.</p><p>The goal is to give you a strong financing resource without requiring you to build an internal lending operation, while keeping you connected to the relationship. We can evaluate working capital, lines of credit, equipment, commercial real estate, and other business-capital needs and determine the most appropriate path for each file.</p><p>If it makes sense, we can do a short introductory conversation, or you can send over a first opportunity and we can show you the process on a live deal.</p><p>${esc(disclosure)}</p><p>Best,<br>Georgie<br>Sierra Marketing Inc.</p>`;
  else if (job.reply_class === "follow_up_later") html = `<p>Hi ${firstName},</p>${delayed}<p>You mentioned reconnecting after your return, so I wanted to follow up at the time you requested.</p><p>I’d be glad to walk through how Sierra can support your clients when a commercial financing need comes up. What day and time works best for a brief conversation?</p><p>${esc(disclosure)}</p><p>Best,<br>Georgie<br>Sierra Marketing Inc.</p>`;
  else if (job.reply_class === "call_request") html = `<p>Hi ${firstName},</p>${delayed}<p>Absolutely. We’d be glad to connect and walk through it directly. Send over a day and time that works well for you and we’ll coordinate the conversation.</p><p>${esc(disclosure)}</p><p>Best,<br>Georgie<br>Sierra Marketing Inc.</p>`;
  else html = `<p>Hi ${firstName},</p>${delayed}<p>Thanks for the reply. I can help clarify how Sierra works and the best next step based on what you’re looking to accomplish.</p><p>If you tell me what type of opportunity or financing need you have in mind, I’ll point you in the right direction without making you repeat information we already have.</p><p>${esc(disclosure)}</p><p>Best,<br>Georgie<br>Sierra Marketing Inc.</p>`;
  return enforceHumanAccessHtml(html);
}

async function reserve(job) {
  await assertAuthority();
  const key = idem(job.obligation_id);
  const existing = await db(`smartlead_reply_delivery_receipts?idempotency_key=eq.${encodeURIComponent(key)}&select=id,provider_message_id,accepted,metadata`);
  if (Array.isArray(existing) && existing.length) return { key, existing: existing[0], created: false };
  await db("smartlead_reply_delivery_receipts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ obligation_id: job.obligation_id, idempotency_key: key, provider_message_id: `reserved:${job.obligation_id}`, sender_mailbox: job.sender_mailbox, recipient_email: job.lead_email, subject: job.subject, accepted: false, rejected: [], metadata: { stage: "reserved", worker: WORKER_ID, worker_version: WORKER_VERSION, authority_generation: authorityGeneration, authority_instance_id: INSTANCE_ID, transport: "smartlead_thread", reply_class: job.reply_class, thread_preservation_required: true, provider_lead_id: job.provider_lead_id || null, provider_lead_email: job.provider_lead_email || null, provider_stats_id: job.provider_stats_id || job.metadata?.provider_stats_id || null } }) });
  return { key, existing: null, created: true };
}

function messageIdOf(m) { return clean(m?.message_id ?? m?.id ?? m?.email_id, 500); }
function messageTimeOf(m) { return m?.sent_at ?? m?.email_time ?? m?.created_at ?? m?.timestamp ?? m?.time ?? m?.date ?? null; }
function typeOf(m) { return String(m?.type ?? m?.message_type ?? m?.email_type ?? m?.event_type ?? m?.direction ?? "").toUpperCase(); }
function senderOf(m) { return String(m?.from_email ?? m?.from ?? m?.sender_email ?? m?.sender ?? "").trim().toLowerCase(); }
function statsIdOf(m) { return clean(m?.stats_id ?? m?.email_stats_id ?? m?.emailStatsId ?? m?.email_stats?.id, 160); }
function isOutbound(m) { return /SENT|OUTBOUND/.test(typeOf(m)); }
function isInbound(m) { return /REPLY|INBOUND/.test(typeOf(m)); }
function mergeHistory(...groups) { const seen = new Set(), merged = []; for (const rows of groups) for (const item of rows || []) { const key = `${messageIdOf(item)}|${messageTimeOf(item) || ""}|${typeOf(item)}`; if (seen.has(key)) continue; seen.add(key); merged.push(item); } return merged.sort((a,b) => Date.parse(messageTimeOf(a) || 0) - Date.parse(messageTimeOf(b) || 0)); }

async function messageHistory(job, leadId) {
  const base = `/campaigns/${job.provider_campaign_id}/leads/${leadId}/message-history`;
  const [plain, canonical] = await Promise.allSettled([smartleadRead(`${base}?show_plain_text_response=true`), smartleadRead(base)]);
  const plainRows = plain.status === "fulfilled" ? unwrapRows(plain.value) : [], canonicalRows = canonical.status === "fulfilled" ? unwrapRows(canonical.value) : [];
  const merged = mergeHistory(plainRows, canonicalRows);
  if (!merged.length && plain.status === "rejected" && canonical.status === "rejected") throw new Error(`SMARTLEAD_THREAD_HISTORY_UNAVAILABLE:${clean(plain.reason?.message || plain.reason,200)}|${clean(canonical.reason?.message || canonical.reason,200)}`);
  return { messages: merged, plainCount: plainRows.length, canonicalCount: canonicalRows.length, dualRead: plain.status === "fulfilled" && canonical.status === "fulfilled" };
}

async function inspectThread(job, leadId) {
  const history = await messageHistory(job, leadId), messages = history.messages, inboundId = String(job.provider_message_id || "");
  const inbound = messages.find(m => messageIdOf(m) === inboundId) || null;
  const inboundTime = Date.parse(messageTimeOf(inbound) || job.metadata?.provider_occurred_at || job.created_at || 0);
  const laterOutbound = messages.filter(m => isOutbound(m) && messageTimeOf(m) && Date.parse(messageTimeOf(m)) > inboundTime + 1000).sort((a,b) => Date.parse(messageTimeOf(b)) - Date.parse(messageTimeOf(a)))[0] || null;
  const newerInbound = messages.filter(m => isInbound(m) && messageTimeOf(m) && Date.parse(messageTimeOf(m)) > inboundTime + 1000 && messageIdOf(m) !== inboundId).sort((a,b) => Date.parse(messageTimeOf(b)) - Date.parse(messageTimeOf(a)))[0] || null;
  return { messages, inbound, inboundFound: Boolean(inbound), inboundTime, laterOutbound, newerInbound, plainCount: history.plainCount, canonicalCount: history.canonicalCount, dualRead: history.dualRead };
}

async function localThreadEvidence(job) {
  const campaignRows = await db(`outreach_campaigns?provider_campaign_id=eq.${encodeURIComponent(job.provider_campaign_id)}&select=id&limit=1`);
  const campaignId = Array.isArray(campaignRows) ? campaignRows[0]?.id : null;
  if (!campaignId) return { replyEvent: null, relatedEvents: [] };
  const rows = await db(`outreach_events?campaign_id=eq.${encodeURIComponent(campaignId)}&select=id,event_type,provider_message_id,occurred_at,metadata&order=occurred_at.asc&limit=500`);
  const relatedEvents = Array.isArray(rows) ? rows : [];
  const replyEvent = relatedEvents.find(e => e.event_type === "email_reply" && String(e.provider_message_id || "") === String(job.provider_message_id || "")) || null;
  return { replyEvent, relatedEvents };
}

function findSentReceiptFromMessages(job, messages, notBefore) {
  const cutoff = Date.parse(notBefore || 0) - 120_000, expectedSender = String(job.sender_mailbox || "").trim().toLowerCase();
  const sent = messages.filter(m => isOutbound(m) && messageTimeOf(m) && Date.parse(messageTimeOf(m)) >= cutoff).sort((a,b) => Date.parse(messageTimeOf(b)) - Date.parse(messageTimeOf(a)));
  for (const m of sent) { const sender = senderOf(m); if (sender && expectedSender && sender !== expectedSender) continue; const providerMessageId = messageIdOf(m); if (!providerMessageId) continue; return { providerMessageId, message: m, senderExposed: Boolean(sender), senderVerified: sender ? sender === expectedSender : null }; }
  return null;
}
async function findSentReceipt(job, leadId, notBefore) { const history = await messageHistory(job, leadId); return findSentReceiptFromMessages(job, history.messages, notBefore); }

async function markProviderAccepted(job, key, providerResponse, statsId) {
  const at = new Date().toISOString();
  await db(`smartlead_reply_delivery_receipts?idempotency_key=eq.${encodeURIComponent(key)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ metadata: { stage: "provider_accepted_waiting_message_id", worker: WORKER_ID, worker_version: WORKER_VERSION, authority_generation: authorityGeneration, authority_instance_id: INSTANCE_ID, transport: "smartlead_thread", provider_response: providerResponse, thread_preservation_required: true, provider_lead_id: job.provider_lead_id || null, provider_lead_email: job.provider_lead_email || null, provider_stats_id: statsId } }) });
  await db(`smartlead_reply_obligations?id=eq.${encodeURIComponent(job.obligation_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ response_status: "queued", lease_expires_at: null, updated_at: at, provider_stats_id: statsId, metadata: { ...(job.metadata || {}), provider_send_accepted: true, provider_send_accepted_at: at, send_reservation: key, send_authority: "georgie_runtime", transport: "smartlead_thread", worker_version: WORKER_VERSION, authority_generation: authorityGeneration, authority_instance_id: INSTANCE_ID, provider_stats_id: statsId } }) });
  return at;
}

async function complete(job, key, receipt, providerResponse, receiptSource) { return rpc("complete_smartlead_reply_closer_work", { p_obligation_id: job.obligation_id, p_worker_id: WORKER_ID, p_idempotency_key: key, p_provider_message_id: receipt.providerMessageId, p_sender_mailbox: job.sender_mailbox, p_subject: job.subject, p_accepted: true, p_rejected: [], p_metadata: { provider: "smartlead", provider_response: providerResponse, receipt_source: receiptSource, worker: WORKER_ID, worker_version: WORKER_VERSION, authority_generation: authorityGeneration, authority_instance_id: INSTANCE_ID, transport: "smartlead_thread", thread_preserved: true, provider_lead_id: job.provider_lead_id || null, provider_lead_email: job.provider_lead_email || null, provider_stats_id: job.provider_stats_id || job.metadata?.provider_stats_id || null, reply_sender_email: job.lead_email, sender_mailbox_expected: job.sender_mailbox, sender_exposed_by_provider: receipt.senderExposed ?? null, sender_verified_when_exposed: receipt.senderVerified ?? null, human_access_disclosure: true } }); }
async function retryableFail(job, error) { try { return await rpc("fail_smartlead_reply_closer_work", { p_obligation_id: job.obligation_id, p_worker_id: WORKER_ID, p_error: clean(error?.message || error, 1000) }); } catch { return null; } }
async function quarantine(job, reason, extra = {}) { const now = new Date().toISOString(); await db(`smartlead_reply_obligations?id=eq.${encodeURIComponent(job.obligation_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ response_status: "human_review", lease_expires_at: null, last_error: clean(reason, 1000), updated_at: now, metadata: { ...(job.metadata || {}), ...extra, quarantine_reason: clean(reason, 500), quarantined_at: now, auto_retry_blocked: true, send_authority: "georgie_runtime", worker_version: WORKER_VERSION, authority_generation: authorityGeneration, authority_instance_id: INSTANCE_ID } }) }); }
async function enrichJob(job) { const rows = await db(`smartlead_reply_obligations?id=eq.${encodeURIComponent(job.obligation_id)}&select=*,outreach_contacts(contact_name)`); const full = Array.isArray(rows) ? rows[0] : null; return full ? { ...job, ...full, contact_name: full.outreach_contacts?.contact_name || "", required_disclosure: full.metadata?.required_disclosure || job.required_disclosure } : job; }

async function reconcileAccepted(limit = 5) {
  const rows = await db(`smartlead_reply_obligations?response_status=eq.queued&metadata->>provider_send_accepted=eq.true&select=*&limit=${Math.max(1, Math.min(limit, 10))}`), results = [];
  if (!Array.isArray(rows) || rows.length === 0) return results;
  await assertAuthority();
  for (const row of rows) {
    try { await assertAuthority(); const job = { ...row, obligation_id: row.id }, leadId = await resolveLeadId(job), receipt = await findSentReceipt(job, leadId, row.metadata?.provider_send_accepted_at || row.updated_at); if (!receipt?.providerMessageId) { results.push({ id: row.id, status: "waiting_receipt" }); continue; } await complete({ ...job, worker_id: WORKER_ID }, row.metadata?.send_reservation || idem(row.id), receipt, { reconciled: true }, "dual_message_history"); console.log("SMARTLEAD_REPLY_CLOSER_RECEIPT", JSON.stringify({ obligationId: row.id, providerMessageId: receipt.providerMessageId, generation: authorityGeneration })); results.push({ id: row.id, status: "reconciled", providerMessageId: receipt.providerMessageId }); }
    catch (error) { if (isStaleAuthorityError(error)) { authorityStale = true; break; } console.error("SMARTLEAD_REPLY_CLOSER_RECEIPT_ERROR", clean(error?.message || error, 500)); results.push({ id: row.id, status: "receipt_error", error: clean(error?.message || error, 300) }); }
  }
  return results;
}

export async function runSmartleadReplyCloserOnce() {
  if (!configured()) return { ok: false, skipped: true, reason: "not_configured" };
  if (authorityGeneration == null || authorityStale) return { ok: true, skipped: true, reason: authorityStale ? "stale_generation" : "authority_not_activated" };
  if (running) return { ok: true, skipped: true, reason: "already_running" };
  running = true; await heartbeat("start"); const cycle = { receipts: [], jobs: [], generation: authorityGeneration, instance: INSTANCE_ID };
  try {
    try { cycle.receipts = await reconcileAccepted(5); }
    catch (error) { if (isStaleAuthorityError(error)) { authorityStale = true; return { ok: true, skipped: true, reason: "stale_generation", ...cycle }; } cycle.receipts = [{ status: "reconcile_batch_error", error: clean(error?.message || error, 300) }]; console.error("SMARTLEAD_REPLY_CLOSER_RECONCILE_BATCH_ERROR", clean(error?.message || error, 500)); }
    let claim;
    try { claim = await rpc("claim_smartlead_reply_closer_work_v2", { p_worker_id: WORKER_ID, p_worker_version: WORKER_VERSION, p_instance_id: INSTANCE_ID, p_generation: authorityGeneration, p_limit: 5, p_lease_seconds: 300 }); }
    catch (error) { if (isStaleAuthorityError(error)) { authorityStale = true; return { ok: true, skipped: true, reason: "stale_generation", ...cycle }; } await heartbeat("error", { ok: false, error, result: cycle }); return { ok: false, worker: WORKER_ID, error: clean(error?.message || error, 500), ...cycle }; }

    for (const raw of Array.isArray(claim?.jobs) ? claim.jobs : []) {
      const job = await enrichJob(raw); let sendAttempted = false;
      try {
        await assertAuthority();
        if (!AUTO_CLASSES.has(job.reply_class) || job.requires_human_review || !job.auto_response_allowed) { await quarantine(job, "AUTO_SEND_POLICY_BLOCK"); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_policy" }); continue; }
        if (!job.provider_campaign_id || !job.provider_message_id || !job.lead_email || !job.sender_mailbox) { await quarantine(job, "THREAD_CONTEXT_INCOMPLETE"); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_context" }); continue; }
        const leadId = await resolveLeadId(job), senderEvidence = await verifySenderMailbox(job), thread = await inspectThread(job, leadId);
        let fallback = null;
        if (!thread.inboundFound) {
          const evidence = await localThreadEvidence(job);
          const existing = await db(`smartlead_reply_delivery_receipts?idempotency_key=eq.${encodeURIComponent(idem(job.obligation_id))}&select=id&limit=1`);
          fallback = evaluateSmartleadWebhookThreadFallback({ job, leadId, replyEvent: evidence.replyEvent, relatedEvents: evidence.relatedEvents, senderEvidence, reservationExists: Array.isArray(existing) && existing.length > 0 });
          if (!fallback.ok) { await quarantine(job, "ORIGINAL_INBOUND_MESSAGE_NOT_FOUND_IN_PROVIDER_THREAD", { sender_evidence: senderEvidence, provider_lead_id: leadId, canonical_history_count: thread.canonicalCount, plain_history_count: thread.plainCount, dual_history_read: thread.dualRead, webhook_fallback_reason: fallback.reason }); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_inbound_missing", fallbackReason: fallback.reason }); continue; }
        }
        if (thread.newerInbound) { await quarantine(job, "NEWER_INBOUND_CONTEXT_EXISTS", { newer_inbound_message_id: messageIdOf(thread.newerInbound), sender_evidence: senderEvidence, provider_lead_id: leadId }); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_newer_context" }); continue; }
        if (thread.laterOutbound) { await quarantine(job, "THREAD_ALREADY_HAS_LATER_OUTBOUND", { later_outbound_message_id: messageIdOf(thread.laterOutbound), sender_evidence: senderEvidence, provider_lead_id: leadId }); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_already_answered" }); continue; }
        const statsId = clean(job.provider_stats_id || job.metadata?.provider_stats_id || statsIdOf(thread.inbound), 160);
        if (!statsId) { await quarantine(job, "PROVIDER_STATS_ID_MISSING", { sender_evidence: senderEvidence, provider_lead_id: leadId }); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_stats_missing" }); continue; }
        if (job.provider_stats_id && thread.inbound && statsIdOf(thread.inbound) && String(job.provider_stats_id) !== statsIdOf(thread.inbound)) { await quarantine(job, "PROVIDER_STATS_ID_MISMATCH", { persisted_stats_id: job.provider_stats_id, inbound_stats_id: statsIdOf(thread.inbound), provider_lead_id: leadId }); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_stats_mismatch" }); continue; }
        await assertAuthority();
        const reservation = await reserve({ ...job, provider_stats_id: statsId });
        if (reservation.existing) { const receipt = findSentReceiptFromMessages(job, thread.messages, job.metadata?.provider_send_accepted_at || job.updated_at || job.created_at); if (receipt?.providerMessageId) { await complete({ ...job, provider_stats_id: statsId, worker_id: WORKER_ID }, reservation.key, receipt, { reconciled: true }, "dual_message_history_existing_reservation"); cycle.jobs.push({ obligationId: job.obligation_id, status: "reconciled", providerMessageId: receipt.providerMessageId }); } else { await quarantine(job, "AMBIGUOUS_EXISTING_SEND_RESERVATION_NO_RETRY", { sender_evidence: senderEvidence, provider_lead_id: leadId, provider_stats_id: statsId }); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_existing_reservation" }); } continue; }
        if (!reservation.created) { await quarantine(job, "RESERVATION_STATE_INVALID"); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_reservation_state" }); continue; }
        const html = replyHtml(job), replyTime = messageTimeOf(thread.inbound) || fallback?.evidence?.replyOccurredAt || job.metadata?.provider_occurred_at || job.created_at || new Date().toISOString(), sendStartedAt = new Date().toISOString();
        await assertAuthority(); sendAttempted = true;
        const providerResponse = await smartleadWrite(`/campaigns/${job.provider_campaign_id}/reply-email-thread`, { email_stats_id: statsId, email_body: html, to_email: job.lead_email, reply_message_id: job.provider_message_id, reply_email_body: job.reply_text, reply_email_time: replyTime, add_signature: false });
        const acceptedAt = await markProviderAccepted({ ...job, provider_stats_id: statsId }, reservation.key, providerResponse, statsId); await sleep(1200);
        const immediateId = clean(providerResponse?.message_id ?? providerResponse?.data?.message_id ?? providerResponse?.id, 500), receipt = immediateId ? { providerMessageId: immediateId, senderExposed: false, senderVerified: null } : await findSentReceipt(job, leadId, sendStartedAt || acceptedAt);
        if (receipt?.providerMessageId) { await complete({ ...job, provider_stats_id: statsId, worker_id: WORKER_ID }, reservation.key, receipt, { ...providerResponse, webhook_fallback: fallback?.evidence || null }, immediateId ? "reply_api" : "dual_message_history"); cycle.jobs.push({ obligationId: job.obligation_id, status: "sent", providerMessageId: receipt.providerMessageId, fallback: Boolean(fallback) }); }
        else cycle.jobs.push({ obligationId: job.obligation_id, status: "provider_accepted_waiting_receipt", fallback: Boolean(fallback) });
      } catch (error) {
        if (isStaleAuthorityError(error)) { authorityStale = true; if (!sendAttempted) await releaseStaleClaim(job); cycle.jobs.push({ obligationId: job.obligation_id, status: "stale_generation_released" }); break; }
        if (sendAttempted) { await quarantine(job, "AMBIGUOUS_PROVIDER_SEND_NO_AUTO_RETRY", { provider_error: clean(error?.message || error, 500), send_attempted: true }); cycle.jobs.push({ obligationId: job.obligation_id, status: "human_review_ambiguous_send", error: clean(error?.message || error, 300) }); }
        else { await retryableFail(job, error); cycle.jobs.push({ obligationId: job.obligation_id, status: "retryable_pre_send_failure", error: clean(error?.message || error, 300) }); }
      }
    }
    if (!authorityStale) await heartbeat("success", { ok: true, result: cycle }); return { ok: true, worker: WORKER_ID, ...cycle };
  } catch (error) { if (!authorityStale) await heartbeat("error", { ok: false, error, result: cycle }); throw error; }
  finally { running = false; }
}

export function startSmartleadReplyCloserWorker() {
  if (timer || authorityRetryTimer || !configured()) { if (!configured()) console.warn("Smartlead reply closer worker not started: Sierra/Smartlead runtime configuration missing"); return; }
  let backpressureFailures = 0;
  const schedule = delayMs => { if (timer) clearTimeout(timer); timer = setTimeout(tick, delayMs); timer.unref?.(); };
  const tick = async () => {
    const permit = specialistExecutionPermit("smartlead-reply-closer");
    if (!permit.allowed) { console.warn("SMARTLEAD_REPLY_CLOSER_CORE_PRESSURE", JSON.stringify({ reason: permit.reason, retryAfterMs: permit.retryAfterMs })); schedule(permit.retryAfterMs); return; }
    let result = null, error = null;
    try { result = await runSmartleadReplyCloserOnce(); }
    catch (caught) { error = caught; console.error("SMARTLEAD_REPLY_CLOSER_ERROR", clean(caught?.stack || caught, 1200)); }
    const next = nextReplyCloserSchedule({ result, error, failures: backpressureFailures, activeMs: ACTIVE_POLL_MS, idleMs: IDLE_POLL_MS, maxBackoffMs: MAX_BACKOFF_MS });
    backpressureFailures = next.failures;
    if (!authorityStale) schedule(next.delayMs);
    if (next.mode === "infra_backoff") console.warn("SMARTLEAD_REPLY_CLOSER_BACKPRESSURE", JSON.stringify({ mode: next.mode, delayMs: next.delayMs, failures: next.failures, version: WORKER_VERSION }));
  };
  const retryDelays = [120_000, 180_000, 240_000, 300_000];
  let retryAttempt = 0;
  const activate = async () => {
    authorityRetryTimer = null;
    try {
      const generation = await activateAuthority();
      retryAttempt = 0;
      await heartbeat("heartbeat");
      schedule(5_000);
      console.log(`Georgie Smartlead threaded reply closer worker online (active=${ACTIVE_POLL_MS}ms idle=${IDLE_POLL_MS}ms maxBackoff=${MAX_BACKOFF_MS}ms) ${WORKER_VERSION} generation=${generation} instance=${INSTANCE_ID}`);
    } catch (error) {
      const delayMs = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];
      retryAttempt += 1;
      console.error("SMARTLEAD_REPLY_CLOSER_AUTHORITY_START_ERROR", clean(error?.stack || error, 1200), `retry_in_ms=${delayMs}`);
      authorityRetryTimer = setTimeout(activate, delayMs);
      authorityRetryTimer.unref?.();
    }
  };
  void activate();
}

export const smartleadReplyCloserWorkerContract = Object.freeze({ version: WORKER_VERSION, workerId: WORKER_ID, transport: "smartlead_reply_email_thread", threadPreservationRequired: true, immutableProviderLeadIdentityPreferred: true, immutableProviderStatsIdentityRequired: true, dualProviderThreadReadRequired: true, provenProviderReplyPayload: "email_stats_id+to_email+reply_message_id+reply_email_body+reply_email_time", replySenderSeparatedFromProviderLead: true, rollingDeployGenerationFence: true, preSendAuthorityReassertion: true, legacyWorkerClaimsDisabled: true, newReservationDistinctFromExistingReservation: true, originalSenderAssignmentRequired: true, providerThreadInboundIdentityRequired: true, providerThreadWebhookFallback: "deterministic_local_event_evidence_only", providerThreadWebhookFallbackRequiresNoReservation: true, suppressIfNewerInboundExists: true, suppressIfLaterOutboundExists: true, blindRetryAfterAmbiguousSend: false, ambiguousSendDisposition: "human_review", autoClasses: [...AUTO_CLASSES], providerReceiptRequired: true, humanAccessDisclosureRequired: true, historicalReplyAgeAwareCopy: true, idempotency: "one durable reservation per obligation", healthHeartbeat: true, adaptiveBackpressure: true, fixedIntervalPolling: false, idlePollRelaxation: true, transientInfraBackoff: true, maxBackoffMs: MAX_BACKOFF_MS, receiptReconcileReadBeforeAuthorityAssert: true, authorityActivationRetry: true, authorityActivationFailClosed: true, authorityActivationRetryMinMs: 120000, authorityActivationRetryMaxMs: 300000 });
