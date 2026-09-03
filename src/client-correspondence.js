import { sendMessage, selectGeorgieCorrespondenceMailbox } from "./integrations/neo-mail.js";
import { getOpenDocumentRequests, ingestInboundCorrespondence, recordOutboundCorrespondence, resolveCorrespondenceTarget } from "./integrations/sierra-correspondence.js";

const HIGH_RISK_LANGUAGE = /\b(accept(?:ance)?|agree(?:ment)?|execute|sign(?:ing)?|authorize|commit(?:ment)?|binding|guarantee|guaranteed|approved?|approval|final terms?|rate|factor|apr|fee|pricing|repayment|payback|daily payment|weekly payment|wire|funding instructions?|bank account|routing number)\b/i;
const SAFE_ROUTINE_CATEGORIES = /document|information|status|follow.?up|scheduling|receipt/i;

function clean(value, max = 4000) { return String(value ?? "").trim().slice(0, max); }
function humanName(value) { return clean(value, 200).replace(/[<>]/g, ""); }

export function containsBindingOrFinancialCommitment(text = "") {
  return HIGH_RISK_LANGUAGE.test(clean(text, 12000));
}

export function buildDocumentReceiptReply({ businessName, requests = [], receivedCount = 0 } = {}) {
  const open = Array.isArray(requests) ? requests.filter(Boolean) : [];
  const intro = receivedCount > 0
    ? `Thank you — I received ${receivedCount} document${receivedCount === 1 ? "" : "s"} and added ${receivedCount === 1 ? "it" : "them"} to your Sierra file.`
    : "Thank you for the update. I have your message attached to the Sierra file.";
  const remaining = open.length
    ? `\n\nTo keep the file moving, we still need:\n${open.map((item) => `• ${clean(item.document_type || item.instructions || "Requested document", 240)}${item.instructions && item.instructions !== item.document_type ? ` — ${clean(item.instructions, 300)}` : ""}`).join("\n")}`
    : "\n\nAt this point, I do not see any additional open document request in Sierra. The file can continue through review based on the evidence currently received.";
  return `${intro}${remaining}\n\nIf anything is unclear, reply here and I’ll keep the file moving.\n\nBest,\nGeorgie\nSierra Capital Advisory`;
}

export function isSafeAutomaticClientReply({ triage = {}, text = "", target = {}, openRequests = [], receivedCount = 0 } = {}) {
  if (!target?.ok || target.match_method !== "client_email" || !target.client_email) return false;
  if (containsBindingOrFinancialCommitment(text)) return false;
  const confidence = Number(triage?.confidence || 0);
  const routine = SAFE_ROUTINE_CATEGORIES.test(`${triage?.category || ""} ${triage?.action || ""} ${triage?.summary || ""}`);
  if (receivedCount > 0) return true;
  if (openRequests.length > 0 && routine && confidence >= 0.85) return true;
  return false;
}

export async function sendClientMessageAndVerify(userId, { reference, to, subject, text, eventType = "georgie_client_followup", idempotencyKey, threadId } = {}) {
  if (!reference || !to || !text) throw new Error("reference, recipient, and message text are required");
  if (containsBindingOrFinancialCommitment(text)) throw new Error("Automatic client correspondence cannot contain binding or financial commitment language");
  const mailbox = selectGeorgieCorrespondenceMailbox();
  if (!mailbox?.id) throw new Error("No configured Georgie NEO correspondence mailbox is available");
  const receipt = await sendMessage(mailbox.id, { to, subject, text, idempotencyKey, dealId: reference, threadId });
  if (!receipt?.messageId || !Array.isArray(receipt.accepted) || receipt.accepted.length === 0 || (receipt.rejected || []).length > 0) throw new Error("NEO SMTP did not return a clean accepted provider receipt");
  const sierra = await recordOutboundCorrespondence(userId, { reference, receipt, message: { to, subject, text }, eventType });
  return { ok: true, mailbox, receipt, sierra };
}

export async function processSierraInboundCorrespondence(userId, { message, triage = {} } = {}) {
  const target = await resolveCorrespondenceTarget(userId, message);
  if (!target?.ok) return { ok: false, matched: false, reason: target?.error || "deal_identity_unresolved" };

  const ingestion = await ingestInboundCorrespondence(userId, { target, message, attachments: message.attachments || [] });
  const requestsSnapshot = await getOpenDocumentRequests(userId, target.reference_number);
  const openRequests = Array.isArray(requestsSnapshot?.requests) ? requestsSnapshot.requests : [];
  const receivedCount = Number(ingestion?.uploaded?.length || 0);
  const replyText = buildDocumentReceiptReply({ businessName: humanName(target.legal_business_name), requests: openRequests, receivedCount });
  const safeAutomaticReply = isSafeAutomaticClientReply({ triage, text: replyText, target, openRequests, receivedCount });

  let outbound = null;
  if (safeAutomaticReply) {
    outbound = await sendClientMessageAndVerify(userId, {
      reference: target.reference_number,
      to: target.client_email,
      subject: message.subject ? `Re: ${clean(message.subject, 900).replace(/^Re:\s*/i, "")}` : `Sierra file ${target.reference_number}`,
      text: replyText,
      eventType: receivedCount > 0 ? "georgie_document_receipt" : "georgie_document_followup"
    });
  }

  return {
    ok: true,
    matched: true,
    reference: target.reference_number,
    target,
    ingestion,
    openRequests,
    automaticReplyEligible: safeAutomaticReply,
    outbound,
    completion: {
      inboundProviderReceipt: Boolean(message.messageId || message.uid),
      crmReadBack: Boolean(ingestion?.verification?.ok),
      documentReadBack: Number(ingestion?.verification?.document_count || 0) === receivedCount,
      internalNotificationReadBack: ingestion?.verification?.notification_exists === true,
      outboundProviderReceipt: outbound ? Boolean(outbound.receipt?.messageId) : null,
      outboundCrmReadBack: outbound ? Boolean(outbound.sierra?.verification?.ok) : null
    }
  };
}
