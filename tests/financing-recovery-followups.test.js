import test from "node:test";
import assert from "node:assert/strict";
import { followupMessageFor, FOLLOWUP_CONTRACT } from "../src/financing-recovery-followups.js";
import { runFinancingRecoveryCycle } from "../src/financing-recovery-worker.js";

test("partial upload follow-up asks only for the remaining month", () => {
  const message = followupMessageFor({
    firstName: "Jason",
    businessIdentity: "Example LLC",
    missingMonths: ["2026-08"],
    followupState: "partial_upload"
  });
  assert.equal(message.version, FOLLOWUP_CONTRACT);
  assert.match(message.subject, /One statement left/);
  assert.match(message.text, /2026-08/);
});

test("final follow-up is restrained", () => {
  const message = followupMessageFor({
    firstName: "Sam",
    businessIdentity: "Sample Inc",
    missingMonths: ["2026-07", "2026-08"],
    followupState: "final_checkin"
  });
  assert.match(message.subject, /keep this funding refresh open/i);
  assert.doesNotMatch(message.text, /approved|guaranteed|pre-approved/i);
});

test("recovery cycle schedules lifecycle work before claiming and scheduler failure is nonfatal", async () => {
  const calls = [];
  const result = await runFinancingRecoveryCycle({
    store: {},
    scheduleFollowups: async body => { calls.push(["schedule", body]); throw new Error("scheduler unavailable"); },
    claim: async body => { calls.push(["claim", body]); return []; },
    precontactReviewAdapter: null
  });
  assert.deepEqual(calls.map(([name]) => name), ["schedule", "claim"]);
  assert.equal(result.claimed, 0);
  assert.equal(result.lifecycle, null);
});
