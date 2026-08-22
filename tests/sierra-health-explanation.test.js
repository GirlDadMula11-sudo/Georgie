import test from "node:test";
import assert from "node:assert/strict";
import { explainSierraHealth } from "../src/integrations/sierra-workforce.js";

test("degraded health with no returned failing condition is explicitly unproven", () => {
  const explanation = explainSierraHealth({
    health_status: "degraded",
    active_deals: 27,
    failed_pipeline_stages: 0,
    failed_lender_deliveries: 0,
    stale_running_stages: 0,
    guarded_lender_activity_evidence_conflicts: 0
  });
  assert.equal(explanation.status, "degraded");
  assert.equal(explanation.causeProven, false);
  assert.equal(explanation.reasons[0].code, "upstream_marked_degraded_without_machine_readable_cause");
  assert.match(explanation.summary, /cause is unproven/i);
});

test("returned failing conditions become the degraded explanation", () => {
  const explanation = explainSierraHealth({ health_status: "degraded", failed_lender_deliveries: 2, stale_running_stages: 1 });
  assert.equal(explanation.causeProven, true);
  assert.deepEqual(explanation.reasons.map((reason) => reason.code), ["lender_delivery_failures", "stale_running_stages"]);
  assert.match(explanation.summary, /failed_lender_deliveries=2/);
  assert.match(explanation.summary, /stale_running_stages=1/);
});
