import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentIntelligence } from "../src/document-intelligence.js";
import { deriveDealWorkspace } from "../src/deal-workspaces.js";
import { deterministicToolPlan } from "../src/fast-intents.js";

const application = {
  id: "doc-app", filename: "CM-100 Application.pdf", document_type: "application", extraction_method: "ocr_v3",
  extracted_fields: {
    business_name: { value: "Mr Muffins LLC", page: 1, confidence: 0.99 }, owner_first_name: { value: "Jason", page: 1, confidence: 0.98 }, owner_last_name: { value: "Sierra", page: 1, confidence: 0.98 },
    home_address: { value: "1 Home Street", page: 1 }, business_address: { value: "2 Business Street", page: 1 }, ssn: { value: "123-45-6789", page: 2, confidence: 0.97 }, dob: { value: "1992-01-01", page: 2 }, ein: { value: "12-3456789", page: 1 },
    gross_annual_sales: { value: "500000", page: 1 }, business_start_date: { value: "2017-01-01", page: 1 }, industry: { value: "Bakery", page: 1 }, authorization_signature: { value: "Jason Sierra", page: 3 }
  }
};

function statement(id, month, deposits, balance, nsfs = 0) {
  return { id, filename: `${month} Statement.pdf`, document_type: "bank_statement", extracted_fields: { statement_month: { value: month, page: 1 }, account_last4: { value: "4321", page: 1 }, total_deposits: { value: deposits, page: 2, confidence: 0.96 }, average_daily_balance: { value: balance, page: 2 }, nsf_count: { value: nsfs, page: 3 }, negative_days: { value: 0, page: 3 } } };
}

test("produces protected page-cited application and statement intelligence", () => {
  const result = buildDocumentIntelligence({ reference: "CM-100", manifest: { documents: [application, statement("s1", "May 2026", 40000, 9000), statement("s2", "June 2026", 50000, 10000), statement("s3", "July 2026", 60000, 11000)] }, deal: { state: "NJ" } });
  assert.equal(result.ready, true);
  assert.equal(result.application.completeness.ratio, 1);
  assert.equal(result.application.fields.find((field) => field.key === "ssn").value, "••••6789");
  assert.equal(result.rawSensitiveValuesStored, false);
  assert.equal(result.bankStatements.metrics.averageMonthlyDeposits, 50000);
  assert.equal(result.bankStatements.statements[0].citations.totalDeposits.page, 2);
  assert.equal(result.citations.some((item) => item.page === 3), true);
});

test("requires four statements for New York and exposes the exact blocker", () => {
  const result = buildDocumentIntelligence({ reference: "SCA-9", manifest: { documents: [application, statement("s1", "May", 1, 1), statement("s2", "June", 1, 1), statement("s3", "July", 1, 1)] }, deal: { business_state: "NY" } });
  assert.equal(result.bankStatements.requiredMonths, 4);
  assert.equal(result.ready, false);
  assert.match(result.nextAction, /Missing 1 required bank statement month/);
});

test("preserves contradictory extracted facts instead of overwriting them", () => {
  const conflicting = { ...application, id: "doc-app-2", extracted_fields: { ...application.extracted_fields, business_name: { value: "Different LLC", page: 1 } } };
  const result = buildDocumentIntelligence({ reference: "CM-100", manifest: { documents: [application, conflicting] } });
  assert.equal(result.application.fields.find((field) => field.key === "businessName").status, "conflict");
  assert.ok(result.blockers.includes("Conflicting Business name"));
});

test("document blockers drive the workspace Ready Blocked Next Action view", () => {
  const documents = buildDocumentIntelligence({ reference: "CM-100", manifest: { documents: [application] } });
  const workspace = deriveDealWorkspace({ reference: "CM-100", graph: { nodes: [], contradictions: [], coverage: { ratio: 0 } }, documentIntelligence: documents });
  assert.equal(workspace.readiness.state, "blocked");
  assert.match(workspace.nextAction, /bank statement/);
  assert.equal(workspace.documentIntelligence.contract, "georgie.document-intelligence.v1");
});

test("routes explicit document intelligence requests to the typed read tool", () => {
  assert.deepEqual(deterministicToolPlan("Show page-cited bank statements for CM-100"), [{ tool: "sierra.document_intelligence", args: { reference: "CM-100" } }]);
});
