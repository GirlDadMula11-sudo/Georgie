const APPLICATION_FIELDS = [
  ["businessName", "Business name", ["business_name", "legal_business_name", "company_name"]],
  ["ownerFirstName", "Owner first name", ["owner_first_name", "first_name", "applicant_first_name"]],
  ["ownerLastName", "Owner last name", ["owner_last_name", "last_name", "applicant_last_name"]],
  ["homeAddress", "Home address", ["home_address", "owner_address", "residential_address"]],
  ["businessAddress", "Business address", ["business_address", "company_address"]],
  ["ssn", "SSN", ["ssn", "social_security_number"]],
  ["dob", "Date of birth", ["dob", "date_of_birth", "birth_date"]],
  ["ein", "EIN", ["ein", "tax_id", "federal_tax_id"]],
  ["annualSales", "Gross annual sales", ["gross_annual_sales", "annual_sales", "annual_revenue"]],
  ["businessStartDate", "Business start date", ["business_start_date", "start_date", "date_established"]],
  ["industry", "Industry", ["industry", "industry_type", "business_type"]],
  ["authorization", "Authorization signature or printed name", ["authorization_signature", "signature", "signed_by", "printed_name"]]
];
const JURISDICTION_ALIASES = ["state", "business_state", "jurisdiction", "business_address_state"];

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function rows(payload) { if (Array.isArray(payload)) return payload; const value = object(payload); for (const key of ["documents", "items", "records", "rows", "data", "results", "manifest"]) if (Array.isArray(value[key])) return value[key]; return Object.keys(value).length ? [value] : []; }
function first(source, keys, fallback = null) { const row = object(source); for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key]; return fallback; }
function number(value) { const numeric = Number(String(value ?? "").replace(/[$,%\s,]/g, "")); return Number.isFinite(numeric) ? numeric : null; }
function confidence(value) { const numeric = number(value); return numeric == null ? null : Math.max(0, Math.min(numeric > 1 ? numeric / 100 : numeric, 1)); }
function clean(value, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function normalizedKey(value) { return clean(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function isSensitive(key) { return ["ssn", "social_security_number", "ein", "tax_id", "federal_tax_id"].includes(normalizedKey(key)); }
function masked(value, key) { const text = clean(value, 200); if (!isSensitive(key)) return text; const digits = text.replace(/\D/g, ""); return digits.length >= 4 ? `••••${digits.slice(-4)}` : text ? "present · protected" : ""; }

function citation(row, field = {}) {
  return {
    documentId: first(field, ["document_id", "artifact_id"], first(row, ["document_id", "artifact_id", "id"])),
    filename: first(field, ["filename", "file_name"], first(row, ["filename", "file_name", "name"])),
    page: first(field, ["page", "page_number", "source_page"], first(row, ["page", "page_number"])),
    sourceArtifactId: first(field, ["source_artifact_id", "artifact_id"], first(row, ["source_artifact_id", "artifact_id", "document_id", "id"])),
    extractedAt: first(field, ["extracted_at", "observed_at"], first(row, ["extracted_at", "processed_at", "updated_at"])),
    extractionMethod: first(field, ["extraction_method", "method", "parser"], first(row, ["extraction_method", "method", "parser"])),
    confidence: confidence(first(field, ["confidence", "confidence_score"], first(row, ["confidence", "confidence_score"])))
  };
}

function fieldCandidates(row) {
  const sources = [object(row.extracted_fields), object(row.fields), object(row.extraction), object(row.structured_data), object(row.data)];
  const candidates = [];
  for (const source of sources) for (const [key, raw] of Object.entries(source)) {
    const detail = object(raw), value = Object.keys(detail).length ? first(detail, ["value", "text", "normalized_value", "observed_value"]) : raw;
    if (value !== undefined && value !== null && value !== "") candidates.push({ key: normalizedKey(key), value, detail });
  }
  return candidates;
}

function classify(row) {
  const text = `${first(row, ["document_type", "classification", "type"], "")} ${first(row, ["filename", "file_name", "name"], "")}`.toLowerCase();
  if (/bank|statement/.test(text)) return "bank_statement";
  if (/application|intake|cm[-_ ]?100/.test(text)) return "application";
  if (/tax|return/.test(text)) return "tax_document";
  if (/driver|passport|identity|\bid\b/.test(text)) return "identity";
  if (/contract|agreement/.test(text)) return "contract";
  return "other";
}

function applicationFacts(documents) {
  const candidates = documents.flatMap((row) => fieldCandidates(row).map((field) => ({ ...field, row })));
  return APPLICATION_FIELDS.map(([key, label, aliases]) => {
    const matches = candidates.filter((item) => aliases.includes(item.key));
    const observations = matches.map((item) => ({ value: masked(item.value, item.key), protected: isSensitive(item.key), citation: citation(item.row, item.detail) }));
    const distinct = [...new Set(observations.map((item) => item.value).filter(Boolean))];
    return { key, label, status: !observations.length ? "missing" : distinct.length > 1 ? "conflict" : "verified", value: distinct.length === 1 ? distinct[0] : null, observations, confidence: observations.length ? Math.min(...observations.map((item) => item.citation.confidence ?? 0.5)) : null };
  });
}

function statementFacts(documents) {
  return documents.filter((row) => classify(row) === "bank_statement").map((row) => {
    const fields = Object.fromEntries(fieldCandidates(row).map((item) => [item.key, item]));
    const value = (aliases) => aliases.map((key) => fields[key]).find(Boolean);
    const observed = (aliases) => { const item = value(aliases); return item ? { value: item.value, citation: citation(row, item.detail) } : { value: null, citation: citation(row) }; };
    const month = observed(["statement_month", "period_month", "month"]), deposits = observed(["total_deposits", "gross_deposits", "deposits"]), withdrawals = observed(["total_withdrawals", "withdrawals", "total_debits"]), averageBalance = observed(["average_daily_balance", "average_balance"]), endingBalance = observed(["ending_balance", "closing_balance"]), nsf = observed(["nsf_count", "nsfs", "returned_items"]), negativeDays = observed(["negative_days", "days_negative"]), debtPayments = observed(["debt_payments", "loan_payments", "mca_payments"]), largeTransactions = observed(["large_transactions", "material_transactions"]), account = observed(["account_last4", "last_four", "account_number"]);
    return {
      documentId: first(row, ["document_id", "artifact_id", "id"]), filename: first(row, ["filename", "file_name", "name"]),
      month: clean(month.value, 40) || null, accountLast4: account.value ? clean(account.value, 40).replace(/.*(\d{4})$/, "$1") : null,
      metrics: { totalDeposits: number(deposits.value), totalWithdrawals: number(withdrawals.value), averageDailyBalance: number(averageBalance.value), endingBalance: number(endingBalance.value), nsfCount: number(nsf.value), negativeDays: number(negativeDays.value), debtPayments: number(debtPayments.value), largeTransactions: array(largeTransactions.value).filter(Boolean) },
      citations: { month: month.citation, accountLast4: account.citation, totalDeposits: deposits.citation, totalWithdrawals: withdrawals.citation, averageDailyBalance: averageBalance.citation, endingBalance: endingBalance.citation, nsfCount: nsf.citation, negativeDays: negativeDays.citation, debtPayments: debtPayments.citation, largeTransactions: largeTransactions.citation }
    };
  });
}

function metricSummary(statements) {
  const values = (key) => statements.map((item) => item.metrics[key]).filter((value) => value != null);
  const average = (items) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null;
  const deposits = values("totalDeposits"), withdrawals = values("totalWithdrawals"), balances = values("averageDailyBalance"), ending = values("endingBalance"), nsfs = values("nsfCount"), negatives = values("negativeDays"), debt = values("debtPayments");
  const trend = deposits.length > 1 ? deposits.at(-1) > deposits[0] ? "increasing" : deposits.at(-1) < deposits[0] ? "decreasing" : "flat" : "unknown";
  return { statementCount: statements.length, averageMonthlyDeposits: average(deposits), averageMonthlyWithdrawals: average(withdrawals), averageDailyBalance: average(balances), averageEndingBalance: average(ending), totalNsfs: nsfs.length ? nsfs.reduce((sum, value) => sum + value, 0) : null, totalNegativeDays: negatives.length ? negatives.reduce((sum, value) => sum + value, 0) : null, totalDebtPayments: debt.length ? debt.reduce((sum, value) => sum + value, 0) : null, cashFlowTrend: trend, coverage: { deposits: deposits.length, withdrawals: withdrawals.length, balances: balances.length, endingBalances: ending.length, nsfs: nsfs.length, negativeDays: negatives.length, debtPayments: debt.length } };
}

export function buildDocumentIntelligence({ reference, manifest, deal = {}, auditEvents = [], observedAt = new Date().toISOString() } = {}) {
  const documents = rows(manifest), application = applicationFacts(documents), statements = statementFacts(documents), metrics = metricSummary(statements);
  const applicationDocument = documents.find((row) => classify(row) === "application");
  const jurisdictionCandidate = applicationDocument && fieldCandidates(applicationDocument).find((item) => JURISDICTION_ALIASES.includes(item.key));
  const jurisdiction = clean(jurisdictionCandidate?.value || first(deal, ["state", "business_state", "jurisdiction"], ""), 20).toUpperCase();
  const jurisdictionCitation = jurisdictionCandidate ? citation(applicationDocument, jurisdictionCandidate.detail) : null;
  const requiredStatementMonths = ["NY", "CA", "NEW YORK", "CALIFORNIA"].includes(jurisdiction) ? 4 : 3;
  const missingApplicationFields = application.filter((field) => field.status === "missing").map((field) => field.label);
  const conflicts = application.filter((field) => field.status === "conflict").map((field) => ({ field: field.key, label: field.label, observations: field.observations }));
  const statementGap = Math.max(0, requiredStatementMonths - statements.length);
  const blockers = [...missingApplicationFields.map((label) => `Missing ${label}`), ...(statementGap ? [`Missing ${statementGap} required bank statement month${statementGap === 1 ? "" : "s"}`] : []), ...conflicts.map((item) => `Conflicting ${item.label}`)];
  const sourceCitations = application.flatMap((field) => field.observations.map((item) => ({ field: field.key, ...item.citation }))).concat(statements.flatMap((statement) => Object.entries(statement.citations).map(([field, source]) => ({ field, ...source }))));
  return {
    contract: "georgie.document-intelligence.v1", mode: "read_only", reference: clean(reference, 100) || null, observedAt,
    documentCount: documents.length, classifications: documents.map((row) => { const extracted = Object.fromEntries(fieldCandidates(row).map((item) => [item.key, item.value])); const type = classify(row); return { documentId: first(row, ["document_id", "artifact_id", "id"]), filename: first(row, ["filename", "file_name", "name"]), type, hash: first(row, ["sha256", "hash", "content_hash"]), pageCount: number(first(row, ["page_count", "pages"])), businessIdentity: clean(first(extracted, ["business_name", "legal_business_name"], first(row, ["business_name", "legal_business_name"])), 200) || null, accountLast4: type === "bank_statement" ? clean(first(extracted, ["account_last4", "last_four"], first(row, ["account_last4", "last_four"])), 40).replace(/.*(\d{4})$/, "$1") || null : null, statementPeriod: type === "bank_statement" ? first(extracted, ["statement_period", "period", "statement_month"], first(row, ["statement_period", "period", "statement_month"])) : null, preserved: first(row, ["preserved", "preservation_verified"], null) }; }),
    application: { fields: application, completeness: { present: application.filter((field) => field.status === "verified").length, required: APPLICATION_FIELDS.length, ratio: application.filter((field) => field.status === "verified").length / APPLICATION_FIELDS.length }, missingFields: missingApplicationFields, conflicts },
    jurisdiction: { value: jurisdiction || null, source: jurisdictionCandidate ? "application" : jurisdiction ? "deal_record" : "unknown", citation: jurisdictionCitation, rule: requiredStatementMonths === 4 ? "NY_CA_four_month" : "standard_three_month" },
    bankStatements: { requiredMonths: requiredStatementMonths, receivedMonths: statements.length, complete: statementGap === 0, missingMonthCount: statementGap, statements, metrics },
    validation: { identity: application.some((field) => field.key === "ssn" && field.status === "verified") && application.some((field) => field.key === "dob" && field.status === "verified") ? "evidence_present" : "incomplete", authorization: application.find((field) => field.key === "authorization")?.status || "missing", dates: application.find((field) => field.key === "businessStartDate")?.status || "missing" },
    unknowns: [...missingApplicationFields.map((label) => ({ type: "missing_application_field", field: label })), ...statements.flatMap((statement) => Object.entries(statement.metrics).filter(([key, value]) => key !== "largeTransactions" && value == null).map(([field]) => ({ type: "missing_statement_metric", documentId: statement.documentId, field }))), ...(!jurisdiction ? [{ type: "missing_jurisdiction" }] : [])],
    contradictions: conflicts, outcome: { state: blockers.length ? "blocked" : "ready", blocked: blockers, nextAction: blockers[0] || "Verify underwriting calculations against the cited source pages" },
    blockers, ready: blockers.length === 0, nextAction: blockers[0] || "Verify underwriting calculations against the cited source pages", citations: sourceCitations.filter((item) => item.documentId || item.sourceArtifactId), auditEvidenceCount: rows(auditEvents).length,
    provenancePreserved: true, rawSensitiveValuesStored: false, writesPerformed: false
  };
}
