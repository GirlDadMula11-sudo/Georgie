import crypto from "node:crypto";
import { buildPrismPrecontactPacket } from "./financing-recovery-evidence.js";
import { recoveryTemplates } from "./financing-recovery-engagement.js";

const list = value => String(value || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
export function syntheticDestination(value, channel) {
  const normalized = String(value || "").trim().toLowerCase();
  if (channel === "email") return /@(example\.(com|net|org)|[^@]+\.(test|invalid))$/.test(normalized);
  return /^\+155501\d{2}$/.test(normalized);
}
export function canaryGate({ env = process.env, email, phone }) {
  if (env.CANARY_MODE !== "true") throw new Error("CANARY_MODE_REQUIRED");
  const emails = list(env.CANARY_EMAIL_ALLOWLIST), phones = list(env.CANARY_PHONE_ALLOWLIST);
  if (!emails.includes(String(email || "").toLowerCase()) || !syntheticDestination(email, "email")) throw new Error("SYNTHETIC_CANARY_EMAIL_NOT_ALLOWLISTED");
  if (!phones.includes(String(phone || "").toLowerCase()) || !syntheticDestination(phone, "sms")) throw new Error("SYNTHETIC_CANARY_PHONE_NOT_ALLOWLISTED");
  return { allowed: true };
}

export async function runSyntheticRehashCanary({ env = process.env, email, phone, adapters, now = new Date() }) {
  canaryGate({ env, email, phone });
  const runId = `canary_${crypto.createHash("sha256").update(`${email}:${phone}:${now.toISOString()}`).digest("hex").slice(0, 20)}`;
  const evidenceVersion = crypto.createHash("sha256").update(`${runId}:synthetic-evidence`).digest("hex");
  const packet = buildPrismPrecontactPacket({ applicantId: `${runId}:applicant`, dealId: `${runId}:deal`, firstName: "Synthetic", businessIdentity: "Synthetic Test Company", missingMonths: ["2026-08", "2026-07"], evidenceIds: [`${runId}:application`, `${runId}:statement`], evidenceVersion, confidence: 0.99, safePersonalizationCues: ["Synthetic canary only"] });
  const evidence = [{ boundary: "gate", status: "verified", receiptId: `${runId}:gate` }];
  const invoke = async (name, configured, action, testAction) => {
    const testTransport = !configured;
    const receipt = await (testTransport ? testAction() : action());
    if (!receipt?.receiptId) throw new Error(`${name.toUpperCase()}_CANARY_RECEIPT_REQUIRED`);
    evidence.push({ boundary: name, status: "verified", transport: testTransport ? "test" : "configured", receiptId: receipt.receiptId });
    return receipt;
  };
  await invoke("database", adapters.database?.configured, () => adapters.database.verify(runId), async () => ({ receiptId: `${runId}:db-test` }));
  await invoke("storage", adapters.storage?.configured, () => adapters.storage.verifySynthetic(runId), async () => ({ receiptId: `${runId}:storage-test` }));
  await invoke("validators", adapters.validators?.configured, () => adapters.validators.verifySynthetic(runId), async () => ({ receiptId: `${runId}:validators-test` }));
  await invoke("prism", adapters.prism?.configured, () => adapters.prism.review(packet), async () => ({ receiptId: `${runId}:prism-test`, readBack: { verified: true } }));
  await invoke("crm", adapters.crm?.configured, () => adapters.crm.verifySynthetic(runId), async () => ({ receiptId: `${runId}:crm-test` }));
  const template = recoveryTemplates({ channel: "email", firstName: "Synthetic", businessIdentity: "Synthetic Test Company", missingMonths: packet.facts.missingRecentMonths, secureLink: "https://example.invalid/recovery/#synthetic", prismPacket: packet });
  await invoke("email", adapters.email?.configured, () => adapters.email.sendTest({ to: email, ...template, idempotencyKey: `${runId}:email` }), async () => ({ receiptId: `${runId}:email-test` }));
  await invoke("sms", adapters.sms?.configured, () => adapters.sms.sendTest({ to: phone, idempotencyKey: `${runId}:sms` }), async () => ({ receiptId: `${runId}:sms-test` }));
  const firstBlockedLiveBoundary = evidence.find(item => item.transport === "test")?.boundary || null;
  return { contract: "georgie.rehash-canary-report.v1", runId, synthetic: true, destinations: { emailDomain: email.split("@")[1], phoneMasked: `***${phone.slice(-4)}` }, evidence, internalPipelineVerified: evidence.every(item => item.status === "verified"), livePipelineVerified: firstBlockedLiveBoundary === null, firstBlockedLiveBoundary, productionDataUsed: false, providerMessagesSent: evidence.filter(item => ["email", "sms"].includes(item.boundary) && item.transport === "configured").length };
}
