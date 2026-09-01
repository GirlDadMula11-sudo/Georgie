import { cloudStateStatus } from "./cloud-state.js";
import { listNeoMailboxes, neoMailConfigured } from "./integrations/neo-mail.js";
import { githubObservabilityConfigured, renderObservabilityConfigured, vercelObservabilityConfigured } from "./integrations/provider-observability.js";
import { githubSourceConfigured } from "./integrations/github-source.js";
import { sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";
import { sierraCorrespondenceConfigured } from "./integrations/sierra-correspondence.js";
import { smartleadConfigured } from "./integrations/smartlead.js";
import { infrastructureAdminCapabilities } from "./integrations/infrastructure-admin.js";
import { getMacDeviceStatus } from "./mac/router.js";
import { getMemoryStorageStatus } from "./memory.js";
import { resourceGovernorStatus } from "./resource-governor.js";
import { listDomainPacks } from "./domain-packs.js";
import { investmentCapabilityContract } from "./investment-intelligence.js";
import { masterCloserContract } from "./master-closer.js";
import { premiumCoreCertificationPlan } from "./premium-core-certification.js";
import { seoContentPipelineContract } from "./seo-content-pipeline.js";
import { deploymentControlStatus } from "./integrations/deployment-control.js";
import { seoIntegrationStatus, websiteControlStatus } from "./integrations/seo-ops.js";
import { objectiveWorkerStatus } from "./objective-worker.js";
import { githubEngineeringStatus } from "./integrations/github-engineering.js";
import { RUNTIME_COMPONENTS, SPECIALIST_START_DELAY_MS, validateRuntimeRegistry } from "./runtime-components.js";

function configured(value) {
  return value ? "configured" : "not_configured";
}

export function getCapabilityManifest() {
  const neoMail = neoMailConfigured();
  const sierraWorkforce = sierraWorkforceConfigured();
  const sierraCorrespondence = sierraCorrespondenceConfigured();
  const smartlead = smartleadConfigured();
  const vercel = vercelObservabilityConfigured();
  const render = renderObservabilityConfigured();
  const github = githubObservabilityConfigured();
  const macDevices = getMacDeviceStatus();
  const memoryStorage = getMemoryStorageStatus();
  const operationalStorage = cloudStateStatus();
  const runtimeRegistry = validateRuntimeRegistry();

  return {
    generatedAt: new Date().toISOString(),
    truthPolicy: {
      configurationIsNotHealthProof: true,
      verifyOnDemandBeforeHealthClaims: true,
      neverInferMissingAccessFromConversationMemory: true,
      rawCredentialsExposedToModel: false
    },
    sessionRuntime: {
      unifiedOperatingRuntime: "unified-georgie-runtime.v2-control-plane",
      operatingLoop: ["understand", "plan", "act", "verify", "recover", "report", "learn"],
      persistentToolRouter: true,
      toolsAttachedToEveryTurn: true,
      planningFailureDegradesToTruthfulAdvisory: true,
      actionJournal: "durable",
      objectiveGraph: "durable",
      unfinishedWorkRecovery: true,
      approvalGates: true,
      killSwitchActive: process.env.GEORGIE_AUTOMATION_KILL_SWITCH === "true",
      fallbackChannels: ["web", "native_ios", "mac_agent", "push_notifications", "neo_mail"],
      runtimeAuthority: {
        valid: runtimeRegistry.ok,
        startupAuthority: "runtime-components",
        componentCount: runtimeRegistry.componentCount,
        components: RUNTIME_COMPONENTS.map(component => component.id),
        objectiveLifecycleKernel: runtimeRegistry.kernel,
        objectiveKernelCount: RUNTIME_COMPONENTS.filter(component => component.role === "kernel").length,
        sourceMutationDuringStartup: false,
        emergencyNeoBackfillInNormalStartup: false,
        durableNeoBackoffEnabled: true,
        executionPlanes: {
          core: RUNTIME_COMPONENTS.filter(component => component.plane === "core").map(component => component.id),
          specialist: RUNTIME_COMPONENTS.filter(component => component.plane === "specialist").map(component => component.id)
        },
        specialistFailureIsolation: true,
        coreFirstStartup: true,
        specialistStartDelayMs: SPECIALIST_START_DELAY_MS
      }
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
      governedSelfEvolution: true,
      durableBackgroundOperations: true,
      sharedEngineeringMission: true,
      durableAssistantHandoffs: true,
      backgroundEngineeringCoordinator: true,
      eliteUniversalTaskKernel: true,
      governedTools: true,
      boundedExecution: true,
      governedInfrastructureAdministration: true
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
    premiumOperatingCore: premiumCoreCertificationPlan(),
    universalCapabilities: {
      reasoning: ["analysis", "planning", "comparison", "scenario_testing", "counterargument", "uncertainty_calibration", "decision_support"],
      knowledgeWork: ["web_research", "document_reasoning", "technical_assistance", "learning_and_explanation", "writing", "creative_development"],
      continuousImprovement: ["capability_gap_detection", "deep_multi_source_research", "historical_context", "trace_review", "held_out_evaluations", "regression_testing", "canary_promotion", "verified_outcome_learning"],
      personalAssistance: ["durable_preferences", "commitment_tracking", "task_coordination", "communication_preparation", "travel_and_purchase_research", "household_planning"],
      operation: ["typed_tool_planning", "approval_gates", "verification", "action_journal", "durable_objective_graph", "unfinished_work_recovery", "ranked_next_actions", "bounded_retries", "kill_switch", "fallback_channels"],
      technologyDevelopment: ["repository_inspection", "bounded_code_search", "source_reading", "patch_preparation", "hash_bound_approval", "patch_application", "allowlisted_checks", "durable_cross_assistant_handoffs", "leased_background_work", "automatic_isolated_branch_commit_policy", "governed_infrastructure_admin"],
      economics: { deterministicFirst: true, cachedEvidencePreferred: true, tieredModelRouting: true, frontierOnlyWhenJustified: true }
    },
    masterCloser: {
      contract: masterCloserContract,
      objectiveIdentity: "georgie-master-closer-v1",
      operatingMode: "governed_copilot_to_preverified_autonomy",
      transactionTypes: ["financing", "sales", "procurement", "vendor", "renewal", "collections", "partnership", "general"],
      capabilities: ["verified_product_intelligence", "multi_product_routing", "dual_track_buyer_reasoning", "calibrated_empathy", "communication_style_adaptation", "adaptive_information_gain_discovery", "ethical_sales_psychology", "state_selected_logical_close", "respectful_disqualification", "verified_offer_normalization", "merchant_priority_modeling", "objection_classification", "offer_ranking", "transaction_playbooks", "negotiation_move_selection", "conditional_concession_ladders", "concession_frontier", "batna_reasoning", "calibrated_questions", "no_response_ladder", "human_escalation", "verified_outcome_learning", "verified_offer_immediate_outreach", "provider_receipt_verification", "crm_correspondence_readback"],
      reasoningTracks: ["human_emotional_state", "logical_decision_state"],
      closeSelection: ["discovery", "proof", "summary", "genuine_choice", "conditional", "stakeholder", "implementation", "next_step", "pause_or_nurture", "respectful_disqualification"],
      psychologyPolicy: { ethicalPersuasion: true, coercion: false, fabricatedScarcity: false, falseUrgency: false, vulnerabilityExploitation: false, protectedTraitTargeting: false },
      objectionCoverage: ["payment", "amount", "term", "cost", "trust", "timing", "competitor_offer", "documents", "confusion", "think_about_it", "partner", "no_response", "ready_to_close"],
      negotiationPrinciples: ["diagnose_before_persuading", "verified_anchors_only", "conditional_concessions", "separate_positions_from_interests", "multiple_equivalent_options", "no_fake_urgency_or_scarcity", "respect_verified_floors", "verify_authority_before_binding"],
      executionQualityTarget: 0.99,
      closeRatePromise: false,
      verifiedOutcomeMeasurementRequired: true,
      fabricatedTermsAllowed: false,
      bindingCommitmentsRequireVerifiedAuthority: true,
      consequentialExternalActionsRemainApprovalGoverned: true,
      syntheticOutcomesTrainProduction: false
    },
    correspondenceExecution: {
      contract: "georgie.sierra-correspondence.v1",
      state: configured(neoMail && sierraCorrespondence),
      loop: ["neo_inbound", "deal_identity", "attachment_hash", "private_storage", "crm_registration", "field_projection", "document_request_resolution", "team_notification", "safe_reply", "provider_receipt", "crm_readback"],
      automaticActions: ["document_receipt", "document_request_followup", "routine_status_followup", "crm_correspondence_projection", "team_notification"],
      automaticBindingTerms: false,
      exactDealIdentityRequired: true,
      providerMessageIdDedupe: true,
      attachmentHashing: "sha256",
      privateStorageBucket: "partner-documents",
      clientHumanEscalationDisclosureRequired: true,
      completionRequires: ["provider_receipt", "crm_readback", "document_readback", "internal_notification_readback"],
      retryOnIncompleteVerification: true
    },
    autonomousObjectiveWorker: objectiveWorkerStatus(),
    governedGitHubEngineering: githubEngineeringStatus(),
    seoOperations: {
      ...seoIntegrationStatus(),
      websiteControl: websiteControlStatus(),
      capabilities: ["search_console_performance","url_inspection","ga4_reporting","technical_crawl","pagespeed_lighthouse","core_web_vitals","sitemap_submission","indexnow","organic_attribution","application_funnel","seo_experiments","funded_outcome_aggregation","synthetic_conversion","durable_evidence_ledger"],
      productionPromotionGoverned: true,
      syntheticRecordsExcludedFromLearning: true,
      borrowerPiiInSeoAnalytics: false
    },
    seoContentProduction: seoContentPipelineContract(),
    deploymentControl: deploymentControlStatus(),
    investmentIntelligence: investmentCapabilityContract(),
    connections: {
      neoMail: {
        state: configured(neoMail),
        callableInChat: neoMail,
        outboundAvailable: neoMail,
        mailboxes: listNeoMailboxes().map(({ id, email, role }) => ({ id, email, role })),
        preferredCloserRole: "georgie_closer",
        liveHealth: "verify_with_email.verify"
      },
      sierraWorkforce: {
        state: configured(sierraWorkforce),
        callableInChat: sierraWorkforce,
        access: sierraWorkforce ? "governed_production_rpc" : "none",
        coverage: sierraWorkforce ? ["portfolio", "deals", "health", "infrastructure", "strategy", "lenders", "offers", "record_level_conflicts", "durable_diagnostics", "deal_evidence_graph", "bounded_repairs", "correspondence_identity", "correspondence_ingest", "document_registration", "correspondence_readback", "internal_notifications"] : [],
        liveHealth: "verify_with_sierra.health_and_sierra.infrastructure"
      },
      githubSource: { state: configured(githubSourceConfigured()), callableInChat: githubSourceConfigured(), access: githubSourceConfigured() ? "authenticated_allowlisted_server_side" : "none", operations: ["repository.list","repository.get","branch.list","branch.get","file.read","source.search","handoff_issue.list","branch.create","commit.create","pull_request.create"], noMacFallback: true, noPublicWebFallback: true },
      infrastructureAdmin: infrastructureAdminCapabilities(),
      deploymentObservability: {
        github: configured(github),
        vercel: configured(vercel),
        render: configured(render),
        liveHealth: "verify_with_system.github_and_system.providers"
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
          commitPushDeploy: "verified_low_risk_repairs_may_commit_to_isolated_branches; merge_and_deploy_remain governed"
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
