const states = ["received", "identity_verified", "documents_pending", "documents_ready", "underwriting", "capitalmatch_ready", "approval_required", "submission_queued", "submitted", "lender_response", "closing", "funded", "declined", "withdrawn", "quarantined"];
const transitions = [
  ["received", "identity_verified"], ["identity_verified", "documents_pending"], ["identity_verified", "documents_ready"], ["documents_pending", "documents_ready"],
  ["documents_ready", "underwriting"], ["underwriting", "capitalmatch_ready"], ["capitalmatch_ready", "approval_required"], ["approval_required", "submission_queued"],
  ["submission_queued", "submitted"], ["submitted", "lender_response"], ["lender_response", "closing"], ["closing", "funded"]
];
const terminal = new Set(["funded", "declined", "withdrawn"]);

export function eventIdempotencyKey(event = {}) { return [event.tenantId, event.aggregateType, event.aggregateId, event.eventType, event.sourceEventId].map((value) => String(value || "").trim()).join(":"); }
export function transitionAllowed(from, to) { return from === to || transitions.some(([a, b]) => a === from && b === to) || (!terminal.has(from) && ["declined", "withdrawn", "quarantined"].includes(to)); }
export function readinessDecision(input = {}) {
  const blockers = [];
  if (!input.identityVerified) blockers.push("identity_not_verified");
  if (!input.applicationAuthorized) blockers.push("application_authorization_missing");
  const requiredMonths = ["NY", "CA"].includes(String(input.state || "").toUpperCase()) ? 4 : 3;
  if (Number(input.consecutiveStatementMonths || 0) < requiredMonths) blockers.push(`bank_statements_require_${requiredMonths}_consecutive_months`);
  if (input.contradictionsUnresolved) blockers.push("evidence_contradiction_unresolved");
  return { ready: blockers.length === 0, state: blockers.length ? "blocked" : "ready", requiredStatementMonths: requiredMonths, blockers };
}

export function derivePhase2DeploymentState(evidence = {}) {
  const contractPresent = evidence.contractPresent !== false;
  const runtimeCommit = String(evidence.runtimeCommit || "").trim();
  const githubSha = String(evidence.githubSha || evidence.github?.latestRun?.headSha || "").trim();
  const renderSha = String(evidence.renderSha || evidence.render?.latestDeployment?.commitId || "").trim();
  const renderStatus = String(evidence.renderStatus || evidence.render?.latestDeployment?.status || "").toLowerCase();
  if (!contractPresent) return { status: "not_present", deployed: false, reason: "phase2_contract_not_present_in_source" };
  if (runtimeCommit) return { status: "contract_deployed", deployed: true, reason: "phase2_contract_is_executing_from_render_runtime_commit", runtimeCommit, evidenceSource: "render_runtime" };
  if (!githubSha || !renderSha) return { status: "source_present_deployment_unverified", deployed: false, reason: "authoritative_commit_evidence_missing" };
  if (githubSha !== renderSha) return { status: "source_present_deployment_diverged", deployed: false, reason: "github_render_commit_mismatch", githubSha, renderSha };
  if (!new Set(["live", "ready", "active"]).has(renderStatus)) return { status: "source_present_deployment_not_live", deployed: false, reason: `render_status_${renderStatus || "unknown"}`, githubSha, renderSha };
  return { status: "contract_deployed", deployed: true, reason: "github_and_render_sha_match_on_live_deployment", githubSha, renderSha, evidenceSource: "github_render" };
}

export function phase2Foundation(evidence = {}) {
  const runtimeCommit = String(evidence.runtimeCommit || process.env.RENDER_GIT_COMMIT || process.env.GEORGIE_DEPLOYED_COMMIT || "").trim();
  const deployment = derivePhase2DeploymentState({ ...evidence, runtimeCommit });
  return {
    schema: "georgie.sierra-phase2-foundation.v1",
    status: deployment.status,
    deployment,
    authority: "prepare_only",
    implementationState: "contract_and_design_only_until_runtime_canary_and_read_back_prove_activation",
    eventContract: { required: ["eventId", "eventType", "schemaVersion", "occurredAt", "receivedAt", "tenantId", "aggregateType", "aggregateId", "source", "sourceEventId", "correlationId", "causationId", "actor", "payloadHash", "payload", "provenance"], immutable: true, ordering: "aggregate_sequence", deduplication: "unique tenantId+aggregateType+aggregateId+eventType+sourceEventId", outboxRequired: true, deadLetterQuarantine: true },
    stateMachine: { states, transitions: transitions.map(([from, to]) => ({ from, to })), terminal: [...terminal], unknownTransition: "reject_and_quarantine", consequentialTransitions: ["approval_required_to_submission_queued", "closing_to_funded"] },
    crmSync: { pattern: "transactional_outbox_to_idempotent_consumer", sourceOfTruth: "canonical_sierra_deal", writePreconditions: ["expected_record_version", "stable_source_id", "idempotency_key", "payload_hash"], conflictPolicy: "preserve_both_and_quarantine", completionProof: ["provider_acceptance", "canonical_read_back", "downstream_effect", "non_duplication"] },
    readiness: { decision: "fail_closed", requiredEvidence: ["authorized_application", "verified_identity_fields", "three_consecutive_bank_statement_months", "four_months_for_NY_or_CA", "resolved_contradictions"], noApprovalPromise: true, capitalMatchBeginsAfterVerifiedIntake: true },
    dashboards: [{ id: "revenue_chain", measures: ["received", "documents_ready", "capitalmatch_ready", "approval_required", "submitted", "funded", "revenue"] }, { id: "reliability", measures: ["event_lag", "queue_depth", "oldest_job_age", "retry_rate", "dead_letters", "duplicate_suppression", "sync_conflicts"] }, { id: "readiness", measures: ["ready_rate", "blocker_distribution", "time_to_ready", "statement_coverage"] }],
    alerts: [{ id: "handoff_missing", condition: "source_transition_without_destination_event_within_sla", severity: "critical" }, { id: "duplicate_effect", condition: "same_idempotency_key_has_multiple_effects", severity: "critical" }, { id: "queue_stale", condition: "oldest_job_age_exceeds_workflow_sla", severity: "high" }, { id: "connector_unverified", condition: "last_verified_at_exceeds_freshness_budget", severity: "high" }, { id: "action_without_delivery", condition: "actionable_request_has_no_queued_delivery_within_seconds", severity: "critical" }],
    rollout: ["schema_and_contract_tests", "shadow_event_capture", "read_only_reconciliation", "single_deal_canary", "bounded_cohort", "independent_read_back", "promote_or_rollback"],
    regressionMatrix: ["duplicate_event", "out_of_order_event", "replayed_webhook", "partial_crm_failure", "provider_timeout", "missing_statement_month", "NY_CA_four_month_rule", "contradictory_identity", "approval_gate", "exactly_once_submission", "lender_reply_linkage", "funding_reconciliation", "rollback", "kill_switch"]
  };
}
