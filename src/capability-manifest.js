import { cloudStateStatus } from "./cloud-state.js";
import { listNeoMailboxes, neoMailConfigured } from "./integrations/neo-mail.js";
import { renderObservabilityConfigured, vercelObservabilityConfigured } from "./integrations/provider-observability.js";
import { sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";
import { smartleadConfigured } from "./integrations/smartlead.js";
import { getMacDeviceStatus } from "./mac/router.js";
import { getMemoryStorageStatus } from "./memory.js";
import { resourceGovernorStatus } from "./resource-governor.js";
import { listDomainPacks } from "./domain-packs.js";

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
      objectiveGraph: "durable",
      unfinishedWorkRecovery: true,
      approvalGates: true,
      killSwitchActive: process.env.GEORGIE_AUTOMATION_KILL_SWITCH === "true",
      fallbackChannels: ["web", "native_ios", "mac_agent", "push_notifications", "neo_mail"]
    },
    productArchitecture: {
      identity: "universal_operating_intelligence",
      enhancementMode: "additive_backward_compatible",
      existingVoicePersonalityAndWorkflowsPreserved: true,
      coreIndependentFromSpecializations: true,
      installedPacks: listDomainPacks(),
      domainCredentialsSeparated: true,
      portableModelAdapters: true
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
    evidenceFoundation: {
      guardedConflictContract: "georgie.guarded-conflict.v1",
      dealEvidenceGraph: "georgie.deal-evidence-graph.v1",
      completeDealStages: ["lead", "application", "documents", "underwriting", "capital_match", "lender_submission", "lender_response", "closing", "funding", "crm_accounting"],
      durableMultiToolInvestigations: true,
      independentStepRecovery: true,
      contradictionsPreserved: true,
      explicitUnknownStates: true,
      writesEnabledByThisLayer: false
    },
    universalCapabilities: {
      reasoning: ["analysis", "planning", "comparison", "scenario_testing", "counterargument", "uncertainty_calibration", "decision_support"],
      knowledgeWork: ["web_research", "document_reasoning", "technical_assistance", "learning_and_explanation", "writing", "creative_development"],
      personalAssistance: ["durable_preferences", "commitment_tracking", "task_coordination", "communication_preparation", "travel_and_purchase_research", "household_planning"],
      operation: ["typed_tool_planning", "approval_gates", "verification", "action_journal", "durable_objective_graph", "unfinished_work_recovery", "ranked_next_actions", "bounded_retries", "kill_switch", "fallback_channels"],
      technologyDevelopment: ["repository_inspection", "bounded_code_search", "source_reading", "patch_preparation", "hash_bound_approval", "patch_application", "allowlisted_checks"],
      economics: { deterministicFirst: true, cachedEvidencePreferred: true, tieredModelRouting: true, frontierOnlyWhenJustified: true }
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
        coverage: sierraWorkforce ? ["portfolio", "deals", "health", "infrastructure", "strategy", "lenders", "offers", "record_level_conflicts", "durable_diagnostics", "deal_evidence_graph", "bounded_repairs"] : [],
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
        onlineDeviceCount: macDevices.filter(device => device.online).length,
        developerWorkspace: {
          serverToolsAttached: true,
          macWorkspaceConfigured: "verify_on_device_with_developer.repo_inspect",
          arbitraryShellAllowed: false,
          secretFilesReadable: false,
          patchExecution: "exact_hash_approval_gated",
          commitPushDeploy: "not_enabled_in_this_release"
        }
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
