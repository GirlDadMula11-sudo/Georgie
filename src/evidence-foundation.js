const STAGES = ["lead", "application", "documents", "underwriting", "capital_match", "lender_submission", "lender_response", "closing", "funding", "crm_accounting"];

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function first(source, keys, fallback = null) { const row = object(source); for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key]; return fallback; }
function rows(payload) { if (Array.isArray(payload)) return payload; const value = object(payload); for (const key of ["conflicts", "records", "rows", "items", "data", "results"]) if (Array.isArray(value[key])) return value[key]; return Object.keys(value).length ? [value] : []; }
function iso(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toISOString(); }
function confidence(value) { const numeric = Number(value); return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null; }
function compact(value, depth = 0) { if (depth > 4) return "[bounded]"; if (Array.isArray(value)) return value.slice(0, 100).map(item => compact(item, depth + 1)); if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 2000) : value; return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, compact(item, depth + 1)])); }

function evidenceRecord(record, index, conflictId) {
  const row = object(record), artifact = object(first(row, ["source_artifact", "artifact", "document"], {}));
  return {
    evidenceId: String(first(row, ["evidence_id", "record_id", "activity_id", "id"], `${conflictId}:evidence:${index + 1}`)),
    field: first(row, ["field", "field_name", "attribute"]), value: compact(first(row, ["value", "field_value", "observed_value", "data"])),
    sourceArtifactId: first(row, ["source_artifact_id", "artifact_id", "document_id"], first(artifact, ["id", "artifact_id"])),
    sourceSystem: first(row, ["source_system", "system", "provider", "origin"]), ingestionPath: first(row, ["ingestion_path", "ingestion_method", "pipeline", "source_path"]),
    eventAt: iso(first(row, ["event_at", "occurred_at", "activity_at", "created_at"])), ingestedAt: iso(first(row, ["ingested_at", "received_at", "updated_at"])),
    version: first(row, ["version", "record_version", "revision"]), extractionMethod: first(row, ["extraction_method", "method", "parser"]),
    confidence: confidence(first(row, ["confidence", "confidence_score"])), provenance: compact(first(row, ["provenance", "source", "metadata"], {}))
  };
}

export function normalizeGuardedConflicts(payload, { reference = null, observedAt = new Date().toISOString() } = {}) {
  const conflicts = rows(payload).map((item, index) => {
    const row = object(item), conflictId = String(first(row, ["conflict_id", "id", "violation_id"], `guarded-conflict:${index + 1}`));
    const deal = object(first(row, ["deal", "affected_deal", "entity"], {})), authority = object(first(row, ["authority", "precedence", "resolution_policy"], {})), impact = object(first(row, ["impact", "operational_impact", "business_impact"], {}));
    const normalized = {
      conflictId, status: first(row, ["status", "conflict_status", "state"], "unknown"),
      deal: { id: first(row, ["deal_id", "entity_id"], first(deal, ["id", "deal_id"])), reference: first(row, ["reference", "deal_reference", "sca_reference"], first(deal, ["reference", "sca_reference"], reference)), merchant: first(row, ["merchant", "merchant_name", "business_name"], first(deal, ["merchant", "business_name"])) },
      workflowStage: first(row, ["workflow_stage", "stage", "pipeline_stage"], "unknown"),
      evidenceRecords: array(first(row, ["conflicting_evidence", "evidence_records", "records", "evidence"], [])).map((record, recordIndex) => evidenceRecord(record, recordIndex, conflictId)),
      fieldDifferences: array(first(row, ["field_differences", "differences", "disputed_fields"], [])).map(item => compact(item)),
      authority: { policy: first(authority, ["policy", "precedence_policy", "name"], first(row, ["authority_policy"])), selectedSource: first(authority, ["selected_source", "authoritative_source"], first(row, ["authoritative_source"])), status: first(authority, ["status", "decision_status"], "undetermined"), reason: first(authority, ["reason", "rationale"]) },
      impact: { business: first(impact, ["business", "business_impact", "description"], first(row, ["business_impact"])), automation: first(impact, ["automation", "automation_impact"], first(row, ["automation_impact"])), blockedActions: array(first(impact, ["blocked_actions", "blocked_workflows"], first(row, ["blocked_actions"], []))) },
      recommendation: compact(first(row, ["recommended_resolution", "recommendation", "next_action"])), auditTrail: array(first(row, ["audit_trail", "events", "history"], [])).map(item => compact(item)),
      observedAt: iso(first(row, ["observed_at", "captured_at"], observedAt)), rawEvidencePreserved: true
    };
    normalized.unknownFields = [["deal.id", normalized.deal.id], ["deal.reference", normalized.deal.reference], ["workflowStage", normalized.workflowStage === "unknown" ? null : normalized.workflowStage], ["evidenceRecords", normalized.evidenceRecords.length ? true : null], ["authority.policy", normalized.authority.policy], ["impact.business", normalized.impact.business]].filter(([, value]) => value == null).map(([field]) => field);
    return normalized;
  });
  return { contract: "georgie.guarded-conflict.v1", mode: "read_only", observedAt, reference, count: conflicts.length, conflicts, unresolved: conflicts.filter(item => !["resolved", "dismissed"].includes(String(item.status).toLowerCase())).length, writesPerformed: false };
}

function sourceRows(source) { return rows(source).map(object); }
function stageSignals(stage, sources) {
  const aliases = { lead: ["lead"], application: ["application", "apply", "submission"], documents: ["document", "statement", "artifact"], underwriting: ["underwriting", "underwriter"], capital_match: ["capitalmatch", "capital_match", "match"], lender_submission: ["lender_submission", "delivery", "submitted"], lender_response: ["lender_response", "offer", "decline", "response"], closing: ["closing", "contract"], funding: ["funding", "funded"], crm_accounting: ["crm", "accounting", "reconciliation"] }[stage];
  const found = [];
  for (const [sourceName, payload] of Object.entries(sources)) for (const row of sourceRows(payload)) if (aliases.some(alias => JSON.stringify(row).toLowerCase().includes(alias))) found.push({ sourceName, row });
  return found;
}

export function buildDealEvidenceGraph({ reference, sources = {}, observedAt = new Date().toISOString() } = {}) {
  const nodes = STAGES.map((stage, index) => {
    const signals = stageSignals(stage, sources), sample = signals[0]?.row || {}, stableId = first(sample, ["deal_id", "application_id", "submission_id", "document_id", "event_id", "id"]), state = first(sample, ["workflow_state", "status", "state", "stage"]);
    return { nodeId: `${reference || "unknown"}:${stage}`, stage, stableRecordId: stableId || null, state: state || "unknown", observedAt: iso(first(sample, ["observed_at", "updated_at", "occurred_at", "created_at"], observedAt)), confidence: confidence(first(sample, ["confidence", "confidence_score"])), extractionMethod: first(sample, ["extraction_method", "method"]), provenance: signals.slice(0, 25).map(signal => ({ source: signal.sourceName, recordId: first(signal.row, ["id", "event_id", "record_id", "submission_id"]), timestamp: iso(first(signal.row, ["occurred_at", "event_at", "updated_at", "created_at"])) })), unknownFields: [!stableId && "stableRecordId", !state && "state", !signals.length && "sourceEvidence"].filter(Boolean), ordinal: index + 1 };
  });
  const edges = nodes.slice(0, -1).map((node, index) => ({ edgeId: `${node.nodeId}->${nodes[index + 1].nodeId}`, from: node.nodeId, to: nodes[index + 1].nodeId, status: node.state !== "unknown" && nodes[index + 1].state !== "unknown" ? "evidenced" : "unknown", transitionAt: nodes[index + 1].observedAt, actor: null, source: nodes[index + 1].provenance.map(item => item.source), evidenceRefs: nodes[index + 1].provenance.map(item => item.recordId).filter(Boolean) }));
  const normalizedConflicts = sources.guardedConflicts?.contract ? sources.guardedConflicts : normalizeGuardedConflicts(sources.guardedConflicts || [], { reference, observedAt });
  const evidenced = nodes.filter(node => !node.unknownFields.includes("sourceEvidence")).length;
  return { contract: "georgie.deal-evidence-graph.v1", mode: "read_only", reference: reference || null, observedAt, stages: STAGES, nodes, edges, contradictions: normalizedConflicts.conflicts, coverage: { evidencedStages: evidenced, totalStages: STAGES.length, ratio: evidenced / STAGES.length }, unknowns: nodes.flatMap(node => node.unknownFields.map(field => `${node.stage}.${field}`)), freshness: Object.fromEntries(Object.entries(sources).map(([name, payload]) => [name, iso(first(object(payload), ["observedAt", "observed_at", "captured_at"])) || observedAt])), sourceContracts: Object.keys(sources), provenancePreserved: true, contradictionsPreserved: true, writesPerformed: false };
}

export function summarizeInvestigationSteps(steps = []) {
  const completed = steps.filter(step => step.status === "completed"), failed = steps.filter(step => step.status === "failed");
  return { completed: completed.length, failed: failed.length, total: steps.length, coverage: steps.length ? completed.length / steps.length : 0, evidenceGaps: failed.map(step => ({ tool: step.tool, error: step.error || "Unavailable" })), sourceFreshness: Object.fromEntries(completed.map(step => [step.tool, step.completedAt || step.startedAt])), contradictions: completed.flatMap(step => array(step.result?.conflicts || step.result?.contradictions)).slice(0, 100) };
}
