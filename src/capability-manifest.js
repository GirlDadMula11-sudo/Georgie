import { cloudStateStatus } from "./cloud-state.js";
import { listNeoMailboxes, neoMailConfigured } from "./integrations/neo-mail.js";
import { renderObservabilityConfigured, vercelObservabilityConfigured } from "./integrations/provider-observability.js";
import { sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";
import { smartleadConfigured } from "./integrations/smartlead.js";
import { getMacDeviceStatus } from "./mac/router.js";
import { getMemoryStorageStatus } from "./memory.js";
import { resourceGovernorStatus } from "./resource-governor.js";

function configured(value) {
  return value ? "configured" : "not_configured";
}

export function getCapabilityManifest() {
  const neoMail = neoMailConfigured();
  const sierraWorkforce = sierraWorkforceConfigured();
  const smartlead = smartleadConfigured();
  const vercel = vercelObservabilityConfigured();
  const render = renderObservabilityConfigured();
  const macDevices = getMacDeviceStatus();
  const memoryStorage = getMemoryStorageStatus();
  const operationalStorage = cloudStateStatus();

  return {
    generatedAt: new Date().toISOString(),
    truthPolicy: {
      configurationIsNotHealthProof: true,
      verifyOnDemandBeforeHealthClaims: true,
      neverInferMissingAccessFromConversationMemory: true,
      rawCredentialsExposedToModel: false
    },
    sessionRuntime: {
      persistentToolRouter: true,
      toolsAttachedToEveryTurn: true,
      planningFailureDegradesToTruthfulAdvisory: true,
      actionJournal: "durable",
      approvalGates: true,
      killSwitchActive: process.env.GEORGIE_AUTOMATION_KILL_SWITCH === "true",
      fallbackChannels: ["web", "native_ios", "mac_agent", "push_notifications", "neo_mail"]
    },
    core: {
      voice: true,
      wakeName: true,
      streamingResponses: true,
      evidenceLifecycle: true,
      tasks: true,
      proactiveMaintenance: true,
      governedTools: true,
      boundedExecution: true
    },
    connections: {
      neoMail: {
        state: configured(neoMail),
        callableInChat: neoMail,
        outboundAvailable: neoMail,
        mailboxes: listNeoMailboxes().map(({ id, email, role }) => ({ id, email, role })),
        liveHealth: "verify_with_email.verify"
      },
      sierraWorkforce: {
        state: configured(sierraWorkforce),
        callableInChat: sierraWorkforce,
        access: sierraWorkforce ? "governed_production_rpc" : "none",
        coverage: sierraWorkforce ? ["portfolio", "deals", "health", "infrastructure", "strategy", "lenders", "offers", "evidence", "bounded_repairs"] : [],
        liveHealth: "verify_with_sierra.health_and_sierra.infrastructure"
      },
      deploymentObservability: {
        vercel: configured(vercel),
        render: configured(render),
        liveHealth: "verify_with_system.providers"
      },
      smartlead: {
        state: configured(smartlead),
        access: smartlead ? "provider_direct_read" : "none",
        liveHealth: "verify_with_campaigns.smartlead"
      },
      durableMemory: memoryStorage,
      durableOperationalState: operationalStorage,
      macAgent: {
        serverCredentialConfigured: Boolean(process.env.GEORGIE_MAC_AGENT_TOKEN),
        callableInChat: Boolean(process.env.GEORGIE_MAC_AGENT_TOKEN),
        devices: macDevices,
        onlineDeviceCount: macDevices.filter(device => device.online).length
      },
      notifications: configured(process.env.GEORGIE_NOTIFICATIONS_ENABLED === "true"),
      webResearch: configured(process.env.GEORGIE_WEB_ENABLED !== "false")
    },
    knownPlatformConstraint: {
      trueBackgroundIphoneListening: false,
      reason: "Safari/PWA microphone access pauses in the background; native iOS signing is required."
    },
    resourceGovernor: resourceGovernorStatus()
  };
}
