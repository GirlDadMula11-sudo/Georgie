import crypto from "node:crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";

const NS = "governed_mailbox_evidence_bridge_v1";
const SCHEMA = "georgie.mailbox-evidence.v1";
const ALLOWED_MAILBOX_DOMAIN = "sierramarketinginc.com";
const allowedMailbox = value => clean(value, 320).toLowerCase().endsWith(`@${ALLOWED_MAILBOX_DOMAIN}`);
const CLASSES = new Set(["authoritative_lender_outcome", "lender_communication", "expert_opinion", "inferred", "test", "unknown"]);
const clean = (value, max = 2000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const hash = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const redact = (value) => clean(value, 1200)
  .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, "[REDACTED_SSN]")
  .replace(/\b\d{2}-?\d{7}\b/g, "[REDACTED_EIN]")
  .replace(/\b(?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])[\/-](?:19|20)\d{2}\b/g, "[REDACTED_DOB]")
  .replace(/\b\d{8,17}\b/g, "[REDACTED_FINANCIAL_NUMBER]")
  .replace(/(?:password|passcode|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token|authorization)\s*[:=]?\s*\S+/ig, "[REDACTED_CREDENTIAL]");
const defaultState = () => ({ schema: SCHEMA, version: 1, objectives: {}, updatedAt: null });
const canonical = (packet) => ({
  objectiveId: clean(packet.objectiveId, 160), batchId: clean(packet.batchId, 160), packetId: clean(packet.packetId, 200),
  mailbox: clean(packet.mailbox, 320).toLowerCase(), messageId: clean(packet.messageId, 500), threadId: clean(packet.threadId, 500),
  timestamp: clean(packet.timestamp, 80), senderDomains: (packet.senderDomains || []).map(v => clean(v, 255).toLowerCase()).filter(Boolean).slice(0, 20),
  recipientDomains: (packet.recipientDomains || []).map(v => clean(v, 255).toLowerCase()).filter(Boolean).slice(0, 20), normalizedSubject: redact(packet.normalizedSubject),
  dealCandidates: (packet.dealCandidates || []).map(v => redact(v)).filter(Boolean).slice(0, 20), lenderCandidates: (packet.lenderCandidates || []).map(v => redact(v)).filter(Boolean).slice(0, 20),
  evidenceClass: CLASSES.has(packet.evidenceClass) ? packet.evidenceClass : "unknown", outcome: packet.outcome && typeof packet.outcome === "object" ? packet.outcome : {},
  attachmentHashes: (packet.attachmentHashes || []).map(v => clean(v, 128).toLowerCase()).filter(v => /^[a-f0-9]{64}$/.test(v)).slice(0, 100),
  sourceLocator: clean(packet.sourceLocator, 800), confidence: Math.max(0, Math.min(1, Number(packet.confidence || 0))),
  conflicts: (packet.conflicts || []).map(v => redact(v)).filter(Boolean).slice(0, 50), excerpt: redact(packet.excerpt), observedAt: clean(packet.observedAt, 80)
});

export function validateMailboxEvidencePacket(packet = {}, scope = {}) {
  const value = canonical(packet);
  if (!value.objectiveId || value.objectiveId !== clean(scope.objectiveId, 160)) throw new Error("MAILBOX_PACKET_OBJECTIVE_MISMATCH");
  if (!allowedMailbox(value.mailbox) || (scope.mailboxes?.length && !scope.mailboxes.map(v => clean(v, 320).toLowerCase()).includes(value.mailbox))) throw new Error("MAILBOX_PACKET_SCOPE_MISMATCH");
  if (!value.batchId || !value.packetId || !value.messageId || !value.timestamp || !value.sourceLocator) throw new Error("MALFORMED_MAILBOX_PACKET");
  value.outcome = JSON.parse(redact(JSON.stringify(value.outcome)) || "{}");
  const packetHash = hash(value);
  if (packet.packetHash && clean(packet.packetHash, 64) !== packetHash) throw new Error("MAILBOX_PACKET_HASH_MISMATCH");
  return { ...value, packetHash };
}

export async function acceptMailboxEvidenceBatch(userId, input = {}) {
  const objectiveId = clean(input.objectiveId, 160), batchId = clean(input.batchId, 160);
  if (!objectiveId || !batchId || input.authority !== "read_only" || input.targetDevice !== "primary-mac") throw new Error("MAILBOX_BATCH_AUTHORIZATION_FAILED");
  const mailboxes = (input.mailboxes || []).map(v => clean(v, 320).toLowerCase());
  if (!mailboxes.length || mailboxes.some(v => !allowedMailbox(v))) throw new Error("MAILBOX_BATCH_SCOPE_INVALID");
  const packets = (input.packets || []).map(packet => validateMailboxEvidencePacket(packet, { objectiveId, mailboxes }));
  if (packets.length > 25) throw new Error("MAILBOX_BATCH_LIMIT_EXCEEDED");
  const state = { ...defaultState(), ...(await readCloudState(String(userId), NS, defaultState())) };
  const objective = state.objectives[objectiveId] || { objectiveId, packets: {}, batches: [], cursors: {}, createdAt: new Date().toISOString() };
  let accepted = 0, duplicates = 0, amended = 0;
  for (const packet of packets) {
    const dedupeKey = hash(`${packet.mailbox}:${packet.messageId}`), prior = objective.packets[dedupeKey];
    if (!prior) { objective.packets[dedupeKey] = { ...packet, dedupeKey, amendments: [] }; accepted += 1; }
    else if (prior.packetHash === packet.packetHash) duplicates += 1;
    else { prior.amendments = [...(prior.amendments || []), { ...packet, amendedAt: new Date().toISOString() }].slice(-50); amended += 1; }
  }
  const receiptBody = { objectiveId, batchId, targetDevice: "primary-mac", authority: "read_only", accepted, duplicates, amended, packetIds: packets.map(p => p.packetId), packetHashes: packets.map(p => p.packetHash), cursor: input.cursor || {}, acceptedAt: new Date().toISOString() };
  const receipt = { ...receiptBody, receiptId: `mbxrcpt_${hash(receiptBody).slice(0, 32)}` };
  objective.batches.push(receipt); objective.batches = objective.batches.slice(-5000); objective.cursors = input.cursor || objective.cursors; objective.updatedAt = receipt.acceptedAt;
  state.objectives[objectiveId] = objective; state.updatedAt = receipt.acceptedAt; await writeCloudState(String(userId), NS, state);
  return receipt;
}

export async function listMailboxPacketManifests(userId, { objectiveId, mailbox = null, limit = 100 } = {}) {
  const state = await readCloudState(String(userId), NS, defaultState()), objective = state.objectives?.[clean(objectiveId, 160)];
  if (!objective) return { objectiveId: clean(objectiveId, 160), packets: [], batches: [], cursor: null };
  const selected = Object.values(objective.packets || {}).filter(p => !mailbox || p.mailbox === clean(mailbox, 320).toLowerCase()).slice(-Math.min(500, Math.max(1, Number(limit || 100))));
  return { objectiveId: objective.objectiveId, cursor: objective.cursors, batches: objective.batches.slice(-25), packets: selected.map(({ excerpt, outcome, amendments, ...packet }) => ({ ...packet, amendmentCount: amendments?.length || 0 })) };
}

export async function getMailboxEvidencePacket(userId, { objectiveId, packetId } = {}) {
  const state = await readCloudState(String(userId), NS, defaultState()), objective = state.objectives?.[clean(objectiveId, 160)];
  const packet = Object.values(objective?.packets || {}).find(p => p.packetId === clean(packetId, 200));
  if (!packet) return null;
  return packet.objectiveId === clean(objectiveId, 160) ? packet : null;
}
