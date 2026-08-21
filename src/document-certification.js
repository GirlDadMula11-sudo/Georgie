import crypto from "node:crypto";
import { getDealWorkspace, refreshDealWorkspace } from "./deal-workspaces.js";

const REQUIRED_METRICS = ["totalDeposits", "totalWithdrawals", "averageDailyBalance", "endingBalance", "nsfCount", "negativeDays", "debtPayments"];
const pass = (name, evidence = {}) => ({ name, passed: true, evidence });
const fail = (name, reason, evidence = {}) => ({ name, passed: false, reason, evidence });

function canonicalDocumentCheck(intelligence) {
  const rows = intelligence?.classifications || [];
  const applicationCount = rows.filter((row) => row.type === "application").length;
  const complete = rows.length === intelligence?.documentCount && applicationCount === 1 && rows.every((row) => row.documentId && row.filename && row.type && row.hash && row.pageCount > 0 && (row.type !== "bank_statement" || (row.accountLast4 && row.statementPeriod)));
  return complete ? pass("canonical_document_inventory", { count: rows.length, documents: rows }) : fail("canonical_document_inventory", "Every file requires a type, hash, page count, and stable document ID", { documents: rows });
}

function fieldEvidenceCheck(intelligence) {
  const fields = intelligence?.application?.fields || [];
  const complete = fields.length > 0 && fields.every((field) => field.status !== "verified" || field.observations.every((item) => item.citation?.documentId && item.citation?.page && item.citation?.confidence != null));
  return complete && !intelligence?.application?.missingFields?.length ? pass("privacy_safe_page_cited_fields", { fields }) : fail("privacy_safe_page_cited_fields", "Required fields must be present and each verified value must have document, page, and confidence", { fields, missing: intelligence?.application?.missingFields || [] });
}

function jurisdictionCheck(intelligence) {
  const item = intelligence?.jurisdiction;
  const valid = item?.value && item?.rule && (item.source !== "application" || (item.citation?.documentId && item.citation?.page));
  return valid ? pass("jurisdiction_and_statement_rule", item) : fail("jurisdiction_and_statement_rule", "Jurisdiction and its three- or four-month rule require cited evidence", item || {});
}

function metricsCheck(intelligence) {
  const statements = intelligence?.bankStatements?.statements || [];
  const missing = statements.flatMap((statement) => REQUIRED_METRICS.filter((field) => statement.metrics?.[field] == null || !statement.citations?.[field]?.page).map((field) => ({ documentId: statement.documentId, field })));
  return statements.length && !missing.length ? pass("complete_statement_metrics", { count: statements.length, summary: intelligence.bankStatements.metrics }) : fail("complete_statement_metrics", "Every statement requires cited deposits, withdrawals, balances, NSF/negative-day, and debt-payment metrics", { missing });
}

function decisionCheck(intelligence) {
  const outcome = intelligence?.outcome;
  return outcome && ["ready", "blocked"].includes(outcome.state) && outcome.nextAction ? pass("formal_ready_blocked_next_action", outcome) : fail("formal_ready_blocked_next_action", "A formal fail-closed outcome and next action are required", outcome || {});
}

export async function certifyDocumentIntelligence({ userId, reference, intelligence, graph, tasks = [], approvals = [], readWorkspace = getDealWorkspace } = {}) {
  const certificationId = crypto.randomUUID();
  const checks = [canonicalDocumentCheck(intelligence), fieldEvidenceCheck(intelligence), jurisdictionCheck(intelligence), metricsCheck(intelligence), pass("contradiction_unknown_register", { contradictions: intelligence?.contradictions || [], unknowns: intelligence?.unknowns || [] }), decisionCheck(intelligence)];
  let saved = null;
  try { saved = await refreshDealWorkspace(userId, { reference, graph, documentIntelligence: intelligence, tasks, approvals }); }
  catch (error) { checks.push(fail("workspace_persistence", error.message)); }
  if (saved) {
    const first = await readWorkspace(userId, reference);
    checks.push(first?.id === saved.id && first?.version === saved.version ? pass("workspace_read_back", { workspaceId: first.id, version: first.version }) : fail("workspace_read_back", "Stored workspace could not be read back by reference"));
    const second = await readWorkspace(userId, reference);
    checks.push(second?.id === saved.id && second?.version === saved.version ? pass("independent_second_read", { workspaceId: second.id, version: second.version }) : fail("independent_second_read", "Independent durable read did not return the certified version"));
  } else {
    checks.push(fail("workspace_read_back", "Workspace was not persisted"), fail("independent_second_read", "Workspace was not persisted"));
  }
  const passed = checks.every((check) => check.passed);
  return { contract: "georgie.document-certification.v1", certificationId, reference, mode: "read_only_certification", passed, disposition: passed && intelligence?.ready ? "ready" : "blocked", checks, blockers: checks.filter((check) => !check.passed).map((check) => check.reason), nextAction: passed ? intelligence.nextAction : checks.find((check) => !check.passed)?.reason || "Resolve missing certification evidence", lenderSubmissionAuthorized: false, consequentialWritesPerformed: false, certifiedAt: new Date().toISOString() };
}
