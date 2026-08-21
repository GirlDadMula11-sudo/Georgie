import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDiagnosticState } from "../src/diagnostic-plans.js";

test("legacy or malformed diagnostic state always receives a safe plans array", () => {
  for (const value of [undefined, null, {}, { version: 1 }, { plans: null }, { plans: "invalid" }]) {
    const normalized = normalizeDiagnosticState(value);
    assert.equal(Array.isArray(normalized.plans), true);
    assert.doesNotThrow(() => normalized.plans.find(() => true));
  }
});

test("valid durable plans are preserved while malformed rows are removed", () => {
  const normalized = normalizeDiagnosticState({ version: 2, plans: [null, { requestId: "request-1" }, "bad"] });
  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.plans, [{ requestId: "request-1" }]);
});
