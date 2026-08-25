function text(v) { return String(v ?? "").trim(); }
function lower(v) { return text(v).toLowerCase(); }
function domain(v) { const s = lower(v); const i = s.lastIndexOf("@"); return i >= 0 ? s.slice(i + 1) : ""; }
function time(v) { const n = Date.parse(v || ""); return Number.isFinite(n) ? n : NaN; }

export function evaluateSmartleadWebhookThreadFallback({ job, leadId, replyEvent, relatedEvents = [], senderEvidence, reservationExists = false }) {
  const deny = reason => ({ ok: false, reason });
  if (!job || !replyEvent) return deny("WEBHOOK_FALLBACK_EVIDENCE_MISSING");
  if (reservationExists) return deny("WEBHOOK_FALLBACK_EXISTING_RESERVATION");
  if (!senderEvidence?.assigned) return deny("WEBHOOK_FALLBACK_SENDER_NOT_ASSIGNED");
  if (lower(job.metadata?.source) !== "smartlead_webhook") return deny("WEBHOOK_FALLBACK_SOURCE_NOT_AUTHORITATIVE");
  if (!text(job.provider_campaign_id) || text(replyEvent.metadata?.campaign_id) !== text(job.provider_campaign_id)) return deny("WEBHOOK_FALLBACK_CAMPAIGN_MISMATCH");
  if (!text(job.provider_message_id) || text(replyEvent.provider_message_id) !== text(job.provider_message_id)) return deny("WEBHOOK_FALLBACK_REPLY_MESSAGE_MISMATCH");
  const eventKey = text(replyEvent.metadata?.smartlead_provider_event_key);
  const expectedEventKey = text(job.provider_event_key || job.metadata?.provider_event_key);
  if (expectedEventKey && eventKey !== expectedEventKey) return deny("WEBHOOK_FALLBACK_PROVIDER_EVENT_MISMATCH");
  const providerLeadId = text(job.provider_lead_id || job.metadata?.provider_lead_id);
  if (!providerLeadId || text(leadId) !== providerLeadId) return deny("WEBHOOK_FALLBACK_PROVIDER_LEAD_MISMATCH");
  const providerLeadEmail = lower(job.provider_lead_email || job.metadata?.provider_lead_email);
  const replySender = lower(job.lead_email || job.metadata?.reply_sender_email);
  const eventSender = lower(replyEvent.metadata?.email);
  if (!providerLeadEmail || !replySender || !eventSender || eventSender !== replySender) return deny("WEBHOOK_FALLBACK_REPLY_SENDER_MISMATCH");
  if (domain(providerLeadEmail) !== domain(replySender)) return deny("WEBHOOK_FALLBACK_COMPANY_DOMAIN_MISMATCH");
  const originalOutbound = text(job.metadata?.original_outbound_message_id);
  if (!originalOutbound) return deny("WEBHOOK_FALLBACK_ORIGINAL_OUTBOUND_MISSING");
  const body = text(replyEvent.metadata?.reply_body);
  const encodedOriginal = encodeURIComponent(originalOutbound).replace(/%40/g, "%40");
  const bodyHasOriginal = body.includes(originalOutbound) || body.includes(encodedOriginal) || body.includes(originalOutbound.replace(/^<|>$/g, ""));
  if (!bodyHasOriginal) return deny("WEBHOOK_FALLBACK_ORIGINAL_OUTBOUND_NOT_CORRELATED");
  const replyAt = time(replyEvent.occurred_at || job.metadata?.provider_occurred_at || job.created_at);
  if (!Number.isFinite(replyAt)) return deny("WEBHOOK_FALLBACK_REPLY_TIME_INVALID");
  const newerInbound = relatedEvents.some(e => lower(e.event_type) === "email_reply" && text(e.provider_message_id) !== text(job.provider_message_id) && time(e.occurred_at) > replyAt + 1000);
  if (newerInbound) return deny("WEBHOOK_FALLBACK_NEWER_INBOUND_EXISTS");
  const laterOutbound = relatedEvents.some(e => lower(e.event_type) === "email_sent" && time(e.occurred_at) > replyAt + 1000);
  if (laterOutbound) return deny("WEBHOOK_FALLBACK_LATER_OUTBOUND_EXISTS");
  return {
    ok: true,
    reason: "WEBHOOK_FALLBACK_VERIFIED",
    evidence: {
      providerCampaignId: text(job.provider_campaign_id),
      providerLeadId,
      providerLeadEmail,
      replySender,
      replyMessageId: text(job.provider_message_id),
      originalOutboundMessageId: originalOutbound,
      replyEventId: text(replyEvent.id),
      providerEventKey: eventKey || expectedEventKey || null,
      senderMailbox: lower(job.sender_mailbox),
      replyOccurredAt: new Date(replyAt).toISOString()
    }
  };
}
