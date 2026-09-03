import { adapterInventory } from "./integrations/financing-recovery-adapters.js";

export function recoveryOperationalReport({ env = process.env, canary = null, inventory = adapterInventory({ env }) } = {}) {
  const validators = { signatureMimeSize: true, malwareScanner: inventory.malware, identityMonth: env.GEORGIE_RECOVERY_DOCUMENT_VALIDATOR_VERIFIED === "true", contentHashDedupe: true };
  const checks = { database: inventory.database, privateStorage: inventory.storage && inventory.storagePublic === false, validators: Object.values(validators).every(Boolean), prism: inventory.prism, crm: inventory.crm, email: inventory.email, sms: inventory.sms, emailWebhook: inventory.webhooks.email, smsWebhook: inventory.webhooks.sms, canary: canary?.livePipelineVerified === true };
  const blockers = Object.entries(checks).filter(([, value]) => !value).map(([name]) => `${name}_not_verified`);
  return { contract: "georgie.recovery-operations.v1", ready: blockers.length === 0, sendsEnabled: false, outreachRelease: "hold", checks, validators, storage: { bucket: inventory.storageBucket, public: false }, canary: canary ? { runId: canary.runId, synthetic: canary.synthetic, internalPipelineVerified: canary.internalPipelineVerified, livePipelineVerified: canary.livePipelineVerified, firstBlockedLiveBoundary: canary.firstBlockedLiveBoundary } : null, blockers, secretsExposed: false, observedAt: new Date().toISOString() };
}
