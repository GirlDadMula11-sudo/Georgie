import { readCloudState, writeCloudState } from "./cloud-state.js";
import { getCapabilityManifest } from "./capability-manifest.js";
import { listApprovals } from "./command-layer.js";
import { listEvents } from "./events.js";
import { listTasks } from "./tasks.js";
import { operatingContinuity } from "./operating-graph.js";
import { maintenanceStatus } from "./maintenance-sentinel.js";
import { revenueControllerStatus } from "./revenue-controller.js";
import { backgroundOperatingStatus } from "./background-operating-layer.js";
import { getGithubObservability, getProviderObservability, getRenderObservability, getVercelObservability } from "./integrations/provider-observability.js";
import { getSierraHealth, getSierraInfrastructure, getSierraReconciliationInvariant, sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";
import { listNeoMailboxes, verifyNeoMailbox } from "./integrations/neo-mail.js";
import { getSmartleadCampaigns, smartleadConfigured } from "./integrations/smartlead.js";

const NS = "intelligence_control_map_v1";
const SCHEMA = "georgie.intelligence-control-map.v1";
const USER = () => process.env.GEORGIE_EXECUTIVE_USER_ID || process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const now = () => new Date().toISOString();
const REFRESH_INTERVAL = Math.max(15 * 60_000, Number(process.env.GEORGIE_CONTROL_MAP_INTERVAL_MS || 60 * 60_000));
let timer = null, refreshing = false;

const HANDOFFS = Object.freeze([
  { id: "intake_to_deal", from: "application_intake", to: "canonical_deal", owner: "Sierra", authoritativeSource: "canonical Sierra deal record", invariants: ["exactly_one_canonical_deal_per_source_application", "stable_source_id", "deduplicated", "required_fields_present", "source_timestamp_preserved"], impact: "Lost or duplicate applications reduce conversion and corrupt attribution." },
  { id: "deal_to_documents", from: "canonical_deal", to: "document_readiness", owner: "Sierra", authoritativeSource: "Sierra document manifest and object metadata", invariants: ["documents_linked_to_correct_deal", "required_document_set_complete", "hash_and_page_count_recorded", "stale_documents_detected"], impact: "Incomplete or mislinked files delay underwriting and lender submission." },
  { id: "documents_to_underwriting", from: "document_readiness", to: "underwriting", owner: "Sierra", authoritativeSource: "page-cited extraction and underwriting record", invariants: ["calculations_reproducible", "citations_resolve", "contradictions_quarantined", "missing_information_blocks_decision"], impact: "Unsupported underwriting creates decline, compliance, and pricing risk." },
  { id: "underwriting_to_capitalmatch", from: "underwriting", to: "capital_match", owner: "Sierra", authoritativeSource: "CapitalMatch eligibility and ranking record", invariants: ["eligibility_before_ranking", "guidelines_separate_from_observed_behavior", "fit_probability_economics_speed_and_confidence_independent", "inputs_versioned"], impact: "Bad matching lowers approvals, economics, and speed to funding." },
  { id: "capitalmatch_to_submission", from: "capital_match", to: "lender_submission", owner: "Sierra + submissions mailbox", authoritativeSource: "approved submission ledger plus provider delivery confirmation", invariants: ["explicit_approval_present", "exactly_once_submission", "idempotency_key_present", "receiving_system_confirmation", "no_silent_queue_failure"], impact: "Duplicate, missing, or unapproved submissions directly threaten revenue and relationships." },
  { id: "submission_to_lender_response", from: "lender_submission", to: "lender_response", owner: "Neo Mail + Sierra", authoritativeSource: "provider mailbox message and linked Sierra correspondence record", invariants: ["thread_linked_to_deal_lender_and_submission", "message_provenance_preserved", "offer_decline_and_request_classification_verified", "ambiguous_messages_quarantined"], impact: "Missed lender responses lose approvals and slow funded volume." },
  { id: "lender_response_to_closing", from: "lender_response", to: "closing", owner: "Sierra", authoritativeSource: "accepted offer and closing checklist", invariants: ["accepted_terms_match_authoritative_offer", "conditions_owned_and_due", "consequential_changes_approved", "closing_readiness_verified"], impact: "Unowned conditions and term mismatch cause fallout before funding." },
  { id: "closing_to_funding", from: "closing", to: "funding", owner: "Sierra + funding evidence", authoritativeSource: "independent funding confirmation", invariants: ["funding_independently_confirmed", "amounts_and_fees_reconciled", "no_funding_claim_from_intent_only"], impact: "False or missing funding state corrupts revenue reporting and follow-up." },
  { id: "funding_to_crm_accounting", from: "funding", to: "crm_accounting", owner: "Sierra + accounting", authoritativeSource: "funding evidence reconciled with CRM and accounting", invariants: ["funded_outcome_recorded_exactly_once", "commission_and_payoff_reconciled", "verified_outcome_promoted_to_intelligence_once", "provenance_and_timestamp_preserved"], impact: "Unreconciled outcomes cause revenue leakage and poison lender intelligence." }
]);

const AUTHORITY = Object.freeze([
  { capability: "observe", default: "automatic", approval: "none", verification: "current authoritative read" },
  { capability: "investigate_and_reconcile", default: "automatic", approval: "none", verification: "evidence provenance and contradiction register" },
  { capability: "prepare_plan_draft_or_simulation", default: "automatic", approval: "none", verification: "bounded scope and no side effect" },
  { capability: "certified_reversible_internal_repair", default: "automatic_only_when_pre_certified", approval: "runbook policy", verification: "canary, independent read-back, idempotency, rollback" },
  { capability: "external_message_or_lender_submission", default: "blocked", approval: "explicit exact-scope approval", verification: "provider acceptance plus canonical record read-back" },
  { capability: "consequential_deal_or_production_mutation", default: "blocked", approval: "explicit exact-scope approval", verification: "authoritative record and downstream effect" },
  { capability: "financial_legal_credential_security_or_destructive_action", default: "blocked", approval: "explicit approval; some actions remain human-only", verification: "specialized control and tested rollback where possible" }
]);

const SYSTEMS = Object.freeze([
  ["sierra_core", "system", "Sierra", "Sierra production RPC", "deal and workflow truth", "critical"],
  ["capitalapply", "application", "Sierra", "Sierra governed inventory", "application intake", "critical"],
  ["capitalmatch", "application", "Sierra", "CapitalMatch decision record", "lender matching", "critical"],
  ["supabase", "database_auth_storage", "Sierra", "Supabase project state", "durable data, auth, storage and queues", "critical"],
  ["georgie_public", "repository", "Engineering", "GitHub public main", "Georgie source revision", "high"],
  ["vercel", "deployment", "Engineering", "Vercel deployment API", "web application delivery", "high"],
  ["render", "deployment_worker", "Engineering", "Render service API", "API and background workers", "critical"],
  ["neo_work", "mailbox", "Executive operations", "Neo Mail provider", "executive correspondence and alerts", "high"],
  ["neo_submissions", "mailbox", "Sierra submissions", "Neo Mail provider", "lender delivery and responses", "critical"],
  ["smartlead", "provider", "Marketing", "Smartlead provider API", "outbound demand generation", "medium"],
  ["operational_state", "database", "Georgie", "Georgie cloud-state RPC", "durable jobs, approvals, maps and recovery", "critical"],
  ["background_operations", "worker", "Georgie", "background operating state", "monitoring and executive notification", "critical"],
  ["revenue_controller", "worker", "Georgie", "revenue controller state", "deal prioritization and progression", "critical"],
  ["self_evolution", "worker", "Georgie", "self-evolution state", "measured capability improvement", "medium"],
  ["mac_agent", "device_connector", "Engineering", "registered Mac agent", "governed workspace inspection", "low"]
]);

function safeError(error) { return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500); }
async function observe(id, fn) { const startedAt = now(); try { const evidence = await fn(); return { id, state: "verified", startedAt, verifiedAt: now(), evidence }; } catch (error) { return { id, state: "unavailable", startedAt, verifiedAt: null, error: safeError(error) }; } }
function compactEvidence(id, value) {
  if (id === "sierra") return { healthStatus: value?.health?.health_status || value?.health?.status || "returned", infrastructureStatus: value?.infrastructure?.status || value?.infrastructure?.overall_status || "returned", reconciliationProven: value?.reconciliation?.completeness_proven === true };
  if (id === "mailboxes") return { mailboxes: value.map((item) => ({ id: item.id, imap: Boolean(item.imap), smtp: Boolean(item.smtp), verifiedAt: item.verifiedAt || null })) };
  if (id === "smartlead") return { recordsReturned: Array.isArray(value) ? value.length : Array.isArray(value?.campaigns) ? value.campaigns.length : 0 };
  return value && typeof value === "object" ? { returned: true, status: value.status || value.state || value.readyState || null, observedAt: value.observedAt || value.generatedAt || null } : { returned: true };
}

export function buildIntelligenceControlMap({ manifest, observations = [], approvals = [], events = [], tasks = [], continuity = {}, maintenance = {}, revenue = {}, background = {}, generatedAt = now() } = {}) {
  const observationById = new Map(observations.map((item) => [item.id, item]));
  const connectionState = { sierra_core: manifest?.connections?.sierraWorkforce?.state, capitalapply: manifest?.connections?.sierraWorkforce?.state, capitalmatch: manifest?.connections?.sierraWorkforce?.state, supabase: manifest?.connections?.durableOperationalState?.enabled ? "configured" : "not_configured", georgie_public: manifest?.connections?.deploymentObservability?.github, vercel: manifest?.connections?.deploymentObservability?.vercel, render: manifest?.connections?.deploymentObservability?.render, neo_work: manifest?.connections?.neoMail?.state, neo_submissions: manifest?.connections?.neoMail?.state, smartlead: manifest?.connections?.smartlead?.state, operational_state: manifest?.connections?.durableOperationalState?.enabled ? "configured" : "not_configured", background_operations: manifest?.core?.durableBackgroundOperations ? "configured" : "not_configured", revenue_controller: revenue?.active ? "configured" : "not_configured", self_evolution: manifest?.core?.governedSelfEvolution ? "configured" : "not_configured", mac_agent: manifest?.connections?.macAgent?.serverCredentialConfigured ? "configured" : "not_configured" };
  const observationKey = { sierra_core: "sierra", capitalapply: "sierra", capitalmatch: "sierra", supabase: "providers", georgie_public: "github", vercel: "vercel", render: "render", neo_work: "mailboxes", neo_submissions: "mailboxes", smartlead: "smartlead", operational_state: "operational_state", background_operations: "background", revenue_controller: "revenue", self_evolution: "maintenance", mac_agent: "mac_agent" };
  const systems = SYSTEMS.map(([id, type, owner, authoritativeSource, revenueDependency, criticality]) => {
    const observation = observationById.get(observationKey[id]);
    return { id, type, owner, authoritativeSource, revenueDependency, criticality, configured: connectionState[id] === "configured", health: observation ? observation.state : "unknown", lastVerifiedAt: observation?.verifiedAt || null, verificationEvidence: observation?.state === "verified" ? compactEvidence(observation.id, observation.evidence) : null, verificationError: observation?.error || null };
  });
  const gaps = [];
  for (const system of systems) {
    if (!system.configured) gaps.push({ type: "connection_gap", target: system.id, severity: system.criticality, detail: "Required capability is not configured." });
    else if (system.health !== "verified") gaps.push({ type: "evidence_gap", target: system.id, severity: system.criticality, detail: "Configured access is not current health proof." });
  }
  for (const item of [...tasks, ...events].filter((entry) => ["urgent", "high"].includes(entry.priority) || /fail|block|incident|stale|contradict|unfinished/i.test(`${entry.title || ""} ${entry.body || ""} ${entry.notes || ""}`)).slice(0, 100)) gaps.push({ type: "open_work", target: item.id, severity: item.priority || "normal", detail: String(item.title || item.body || "Open work").slice(0, 500), source: item.type || item.source || "durable_work" });
  const unfinished = Array.isArray(continuity?.unfinishedJobs) ? continuity.unfinishedJobs : Array.isArray(continuity?.nodes) ? continuity.nodes.filter((item) => !["completed", "verified", "closed"].includes(item.status)) : [];
  for (const item of unfinished.slice(0, 100)) gaps.push({ type: "unfinished_work", target: item.id || item.objectiveId || "unknown", severity: item.priority || "normal", detail: String(item.title || item.objective || item.nextAction || "Durable work is unfinished").slice(0, 500) });
  return {
    schema: SCHEMA, version: 1, generatedAt, truthPolicy: { configurationIsNotHealthProof: true, changingFactsRequireTimestampedEvidence: true, contradictionsArePreserved: true, unknownIsNotHealthy: true, attemptedIsNotCompleted: true },
    operatingLoop: ["map", "observe", "detect_deviation", "investigate", "repair_within_authority", "verify", "notify", "learn"],
    systems, handoffs: HANDOFFS, authority: AUTHORITY,
    approvals: { pending: approvals.slice(0, 100).map((item) => ({ id: item.id, actionType: item.actionType, title: item.title, risk: item.risk, reversible: item.reversible, status: item.status, createdAt: item.createdAt, verificationMethod: item.verificationMethod, rollbackPlan: item.rollbackPlan })) },
    gaps,
    incidents: Array.isArray(background?.incidents) ? background.incidents.slice(0, 100) : [],
    notificationRoutes: { critical: ["native_or_web_push", "executive_work_email"], approvalNeeded: ["control_center", "native_or_web_push", "executive_work_email"], routine: ["daily_control_brief"], resolved: ["control_center", "executive_work_email"], quietHours: background?.policy ? { start: background.policy.quietStartHour, end: background.policy.quietEndHour, timeZone: background.policy.timeZone } : null, deliveryCertified: Boolean(background?.lastDeliveryAt) },
    recovery: { durableState: Boolean(manifest?.connections?.durableOperationalState?.enabled), unfinishedWorkRecovery: Boolean(manifest?.sessionRuntime?.unfinishedWorkRecovery), boundedRetries: true, idempotencyRequired: true, independentVerificationRequired: true, rollbackRequiredForRepair: true, globalKillSwitch: { available: true, active: Boolean(manifest?.sessionRuntime?.killSwitchActive), coverage: ["background_operations", "automated_repair", "notification_delivery"] } },
    runtime: { maintenance: { active: maintenance?.active ?? null, lastCycleAt: maintenance?.lastCycleAt || null }, revenueController: { active: Boolean(revenue?.active), phase: revenue?.phase || 0, assignedDeals: revenue?.coverage?.assignedDeals || 0, lastCycleAt: revenue?.lastCycleAt || null }, backgroundOperations: { active: Boolean(background?.active), mode: background?.mode || null, lastCycleAt: background?.lastCycleAt || null } },
    certification: { systemCount: systems.length, verifiedSystems: systems.filter((item) => item.health === "verified").length, handoffCount: HANDOFFS.length, pendingApprovals: approvals.length, gaps: gaps.length, endToEndCertified: systems.filter((item) => item.criticality === "critical").every((item) => item.health === "verified") && gaps.filter((item) => item.severity === "critical").length === 0 }
  };
}

async function durableInputs(userId) {
  const uid = String(userId || USER());
  const [approvals, events, tasks, continuity, maintenance, revenue, background] = await Promise.all([listApprovals(uid, { status: "pending", limit: 100 }), listEvents(uid, { status: "pending", limit: 200 }), listTasks(uid, { status: "open", limit: 200 }), operatingContinuity(uid, { limit: 200 }), maintenanceStatus(uid), revenueControllerStatus(uid), backgroundOperatingStatus(uid)]);
  return { approvals, events, tasks, continuity, maintenance, revenue, background };
}

export async function refreshIntelligenceControlMap(userId = USER()) {
  if (refreshing) return readCloudState(String(userId || USER()), NS, { schema: SCHEMA, version: 1, generatedAt: null, systems: [], handoffs: HANDOFFS, authority: AUTHORITY, gaps: [{ type: "refresh_in_progress", target: "control_map", severity: "normal", detail: "A current map refresh is already running." }], certification: { systemCount: 0, verifiedSystems: 0, handoffCount: HANDOFFS.length, pendingApprovals: 0, gaps: 1, endToEndCertified: false } });
  refreshing = true;
  const uid = String(userId || USER()), manifest = getCapabilityManifest();
  try { const observations = await Promise.all([
    sierraWorkforceConfigured() ? observe("sierra", async () => { const [health, infrastructure, reconciliation] = await Promise.all([getSierraHealth(uid), getSierraInfrastructure(uid), getSierraReconciliationInvariant(uid, { limit: 250 })]); return { health, infrastructure, reconciliation }; }) : Promise.resolve({ id: "sierra", state: "not_configured", verifiedAt: null }),
    observe("github", getGithubObservability), observe("vercel", getVercelObservability), observe("render", getRenderObservability), observe("providers", getProviderObservability),
    observe("operational_state", async () => manifest.connections.durableOperationalState),
    observe("background", async () => (await backgroundOperatingStatus(uid))), observe("revenue", async () => (await revenueControllerStatus(uid))), observe("maintenance", async () => (await maintenanceStatus(uid))),
    observe("mac_agent", async () => manifest.connections.macAgent),
    observe("mailboxes", async () => Promise.all(listNeoMailboxes().map(async (mailbox) => ({ id: mailbox.id, ...(await verifyNeoMailbox(mailbox.id)), verifiedAt: now() })))),
    smartleadConfigured() ? observe("smartlead", getSmartleadCampaigns) : Promise.resolve({ id: "smartlead", state: "not_configured", verifiedAt: null })
    ]);
    const inputs = await durableInputs(uid), map = buildIntelligenceControlMap({ manifest, observations, ...inputs });
    if (!await writeCloudState(uid, NS, map)) throw new Error("Durable Intelligence and Control Map storage is unavailable");
    return map;
  } finally { refreshing = false; }
}

export async function intelligenceControlMapStatus(userId = USER(), { refresh = false } = {}) {
  if (refresh) return refreshIntelligenceControlMap(userId);
  const stored = await readCloudState(String(userId || USER()), NS, null);
  return stored?.schema === SCHEMA ? stored : refreshIntelligenceControlMap(userId);
}

export function intelligenceControlMapBrief(map = {}) {
  const c = map.certification || {}, critical = (map.gaps || []).filter((item) => item.severity === "critical"), unknown = (map.systems || []).filter((item) => item.health !== "verified");
  return [
    "INTELLIGENCE AND CONTROL MAP — DURABLE CONTROL BRIEF", "",
    `State: ${c.endToEndCertified ? "CERTIFIED" : "ATTENTION — evidence gaps remain"}`,
    `Inventory: ${c.systemCount || 0} systems, ${c.handoffCount || 0} revenue-chain handoffs, ${c.verifiedSystems || 0} systems currently verified.`,
    `Authority: observe, investigate, reconcile, and prepare automatically; consequential execution remains exact-scope approval-gated.`, "",
    `Critical gaps: ${critical.length}. Unknown or stale system health: ${unknown.length}. Pending approvals: ${c.pendingApprovals || 0}.`,
    ...(critical.slice(0, 5).map((item) => `- ${item.target}: ${item.detail}`)), "",
    "Operating loop: Map → observe → detect deviation → investigate → repair within authority → verify → notify → learn.",
    `Durable version: ${map.schema || SCHEMA}; generated ${map.generatedAt || "time unavailable"}. No credential values are stored in the map.`
  ].join("\n");
}

export function startIntelligenceControlMap() {
  if (process.env.GEORGIE_CONTROL_MAP_ENABLED === "false" || timer) return timer;
  void refreshIntelligenceControlMap().catch((error) => console.warn("Intelligence and Control Map refresh failed:", safeError(error)));
  timer = setInterval(() => void refreshIntelligenceControlMap().catch((error) => console.warn("Intelligence and Control Map refresh failed:", safeError(error))), REFRESH_INTERVAL);
  timer.unref?.();
  return timer;
}
