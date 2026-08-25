import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSmartleadWebhookThreadFallback } from "../src/smartlead-reply-fallback-evidence.js";

const outbound = "<cf5bd656-86fe-4318-ba79-a3173829f01a@trustedsierracapital.com>";
const replyId = "<reply@mail.gmail.com>";
function base() {
  const job = {
    provider_campaign_id: "3814669",
    provider_message_id: replyId,
    provider_event_key: "smartlead:event-1",
    provider_lead_id: "4372028940",
    provider_lead_email: "contactus@safehavencommercial.com",
    lead_email: "premal@safehavencommercial.com",
    sender_mailbox: "jason.sierra@trustedsierracapital.com",
    metadata: {
      source: "smartlead_webhook",
      provider_lead_id: "4372028940",
      provider_lead_email: "contactus@safehavencommercial.com",
      reply_sender_email: "premal@safehavencommercial.com",
      original_outbound_message_id: outbound,
      provider_occurred_at: "2026-08-20T19:49:42Z"
    }
  };
  const replyEvent = {
    id: "event-row-1",
    event_type: "email_reply",
    provider_message_id: replyId,
    occurred_at: "2026-08-20T19:50:36Z",
    metadata: {
      email: "premal@safehavencommercial.com",
      campaign_id: "3814669",
      smartlead_provider_event_key: "smartlead:event-1",
      reply_body: `quoted messageId=${encodeURIComponent(outbound)}`
    }
  };
  return { job, leadId: "4372028940", replyEvent, relatedEvents: [replyEvent], senderEvidence: { assigned: true }, reservationExists: false };
}

test("allows deterministic webhook fallback", () => {
  const r = evaluateSmartleadWebhookThreadFallback(base());
  assert.equal(r.ok, true);
  assert.equal(r.reason, "WEBHOOK_FALLBACK_VERIFIED");
  assert.equal(r.evidence.providerLeadId, "4372028940");
});

test("blocks mismatched campaign", () => {
  const x = base(); x.replyEvent.metadata.campaign_id = "other";
  assert.equal(evaluateSmartleadWebhookThreadFallback(x).reason, "WEBHOOK_FALLBACK_CAMPAIGN_MISMATCH");
});

test("blocks mismatched provider lead", () => {
  const x = base(); x.leadId = "999";
  assert.equal(evaluateSmartleadWebhookThreadFallback(x).reason, "WEBHOOK_FALLBACK_PROVIDER_LEAD_MISMATCH");
});

test("blocks newer inbound for same lead identity", () => {
  const x = base(); x.relatedEvents.push({ event_type: "email_reply", provider_message_id: "<newer>", occurred_at: "2026-08-20T20:00:00Z", metadata: { email: "premal@safehavencommercial.com" } });
  assert.equal(evaluateSmartleadWebhookThreadFallback(x).reason, "WEBHOOK_FALLBACK_NEWER_INBOUND_EXISTS");
});

test("ignores unrelated campaign contact activity", () => {
  const x = base(); x.relatedEvents.push({ event_type: "email_sent", provider_message_id: "<unrelated>", occurred_at: "2026-08-20T20:00:00Z", metadata: { email: "other@example.com" } });
  assert.equal(evaluateSmartleadWebhookThreadFallback(x).ok, true);
});

test("blocks later outbound for same lead identity", () => {
  const x = base(); x.relatedEvents.push({ event_type: "email_sent", provider_message_id: "<later>", occurred_at: "2026-08-20T20:00:00Z", metadata: { email: "contactus@safehavencommercial.com" } });
  assert.equal(evaluateSmartleadWebhookThreadFallback(x).reason, "WEBHOOK_FALLBACK_LATER_OUTBOUND_EXISTS");
});

test("blocks existing reservation", () => {
  const x = base(); x.reservationExists = true;
  assert.equal(evaluateSmartleadWebhookThreadFallback(x).reason, "WEBHOOK_FALLBACK_EXISTING_RESERVATION");
});

test("blocks cross-domain reply identity", () => {
  const x = base(); x.job.lead_email = "attacker@example.com"; x.replyEvent.metadata.email = "attacker@example.com";
  assert.equal(evaluateSmartleadWebhookThreadFallback(x).reason, "WEBHOOK_FALLBACK_COMPANY_DOMAIN_MISMATCH");
});

test("blocks missing original outbound correlation", () => {
  const x = base(); x.replyEvent.metadata.reply_body = "no quoted original";
  assert.equal(evaluateSmartleadWebhookThreadFallback(x).reason, "WEBHOOK_FALLBACK_ORIGINAL_OUTBOUND_NOT_CORRELATED");
});
