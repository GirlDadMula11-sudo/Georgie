import { neoMailConfigured, listNeoMailboxes } from "./integrations/neo-mail.js";
import { validateSmsAdapter } from "./financing-recovery-engagement.js";

export function financingRecoveryReadiness({ env = process.env, smsAdapter = null, evidenceConnector = null, prismAdapter = null } = {}) {
  const checks = {
    durableStore: Boolean(env.GEORGIE_SUPABASE_URL && env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY),
    evidenceVaultConnector: evidenceConnector?.contract === "georgie.recovery-evidence-connector.v1" && evidenceConnector.configured === true,
    prismPrecontactPacket: prismAdapter?.contract === "georgie.prism-precontact.v1" && prismAdapter.configured === true,
    secureUpload: Boolean(env.GEORGIE_RECOVERY_UPLOAD_ORIGIN && env.GEORGIE_RECOVERY_UPLOAD_TOKEN_SECRET),
    crmCreationGate: env.GEORGIE_RECOVERY_CRM_GATE_VERIFIED === "true",
    georgieEmailSender: neoMailConfigured() && listNeoMailboxes().some(mailbox => ["georgie_closer", "client_correspondence"].includes(mailbox.role)),
    smsProviderNumberRegistration: validateSmsAdapter(smsAdapter),
    smsWebhookVerification: validateSmsAdapter(smsAdapter) && smsAdapter.webhookVerificationConfigured === true,
    closerAuthority: true,
    omnichannelSuppression: env.GEORGIE_RECOVERY_OMNICHANNEL_SUPPRESSION_VERIFIED === "true",
    outreachHeld: env.GEORGIE_FINANCING_OUTREACH_RELEASE !== "canary"
  };
  return { contract: "georgie.financing-recovery-readiness.v1", ready: Object.entries(checks).filter(([key]) => key !== "outreachHeld").every(([, value]) => value === true), checks };
}
