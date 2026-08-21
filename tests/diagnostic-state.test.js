import test from "node:test";
import assert from "node:assert/strict";
import { canonicalReferenceFromDeal, normalizeDiagnosticState, unresolvedEvidencePaths } from "../src/diagnostic-plans.js";

test("legacy or malformed diagnostic state always receives a safe plans array", () => {
  for (const value of [undefined, null, {}, { version: 1 }, { plans: null }, { plans: "invalid" }]) {
    const normalized = normalizeDiagnosticState(value);
    assert.equal(Array.isArray(normalized.plans), true);
    assert.doesNotThrow(() => normalized.plans.find(() => true));
  }
});

test("merchant lookup resolves the canonical Sierra reference from nested deal evidence", () => {
  assert.equal(canonicalReferenceFromDeal({ deal: { business_name: "Mr Muffins", sca_reference: "SCA-100" } }), "SCA-100");
});

test("unresolved evidence reports exact paths instead of a generic unknown", () => {
  const paths = unresolvedEvidencePaths({ unknowns: ["underwriting.stableRecordId"], stages: [{ state: "unknown" }] });
  assert.match(paths.join("\n"), /result\.unknowns\[0\]: underwriting\.stableRecordId/);
  assert.match(paths.join("\n"), /result\.stages\[0\]\.state: unknown/);
});

test("valid durable plans are preserved while malformed rows are removed", () => {
  const normalized = normalizeDiagnosticState({ version: 2, plans: [null, { requestId: "request-1" }, "bad"] });
  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.plans, [{ requestId: "request-1" }]);
});
