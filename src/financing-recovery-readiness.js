import { neoMailConfigured, listNeoMailboxes } from "./integrations/neo-mail.js";
import { validateSmsAdapter } from "./financing-recovery-engagement.js";
import { adapterInventory } from "./integrations/financing-recovery-adapters.js";

export function financingRecoveryReadiness({ env = process.env, smsAdapter = null, evidenceConnector = null, prismAdapter = null, canary = null } = {}) {
  const inventory = adapterInventory({ env });
  const checks = {
    durableStore: inventory.database,
    privateStatementStorage: inventory.storage && inventory.storagePublic === false,
    evidenceVaultConnector: evidenceConnector?.contract === "georgie.recovery-evidence-connector.v1" && evidenceConnector.configured === true,
    signatureMimeSizeValidator: true,
    malwareScanner: inventory.malware,
    identityMonthValidator: env.GEORGIE_RECOVERY_DOCUMENT_VALIDATOR_VERIFIED === "true",
    prismPrecontactPacket: (prismAdapter?.contract === "georgie.prism-precontact.v1" && prismAdapter.configured === true) || inventory.prism,
    secureUpload: Boolean(env.GEORGIE_RECOVERY_UPLOAD_ORIGIN && env.GEORGIE_RECOVERY_UPLOAD_TOKEN_SECRET),
    crmCreationGate: inventory.crm,
    georgieEmailSender: neoMailConfigured() && listNeoMailboxes().some(mailbox => ["georgie_closer", "client_correspondence"].includes(mailbox.role)),
    emailWebhookVerification: inventory.webhooks.email,
    smsProviderNumberRegistration: validateSmsAdapter(smsAdapter),
    smsWebhookVerification: validateSmsAdapter(smsAdapter) && smsAdapter.webhookVerificationConfigured === true,
    closerAuthority: true,
    omnichannelSuppression: env.GEORGIE_RECOVERY_OMNICHANNEL_SUPPRESSION_VERIFIED === "true",
    syntheticCanary: canary?.livePipelineVerified === true,
    outreachHeld: env.GEORGIE_FINANCING_OUTREACH_RELEASE !== "canary"
  };
  const required = Object.entries(checks).filter(([key]) => key !== "outreachHeld");
  return { contract: "georgie.financing-recovery-readiness.v2", ready: required.every(([, value]) => value === true), sendsEnabled: false, checks, blockers: required.filter(([, value]) => !value).map(([key]) => `${key}_not_verified`), secretsExposed: false };
}
