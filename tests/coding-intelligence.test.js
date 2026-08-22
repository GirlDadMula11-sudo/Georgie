import test from "node:test";
import assert from "node:assert/strict";
import { assessCodingEvidence, codingAuthority, codingRisk, codingRuntimePrompt, isCodingRequest } from "../src/coding-intelligence.js";

test("detects engineering requests without treating ordinary conversation as coding", () => {
  assert.equal(isCodingRequest("Diagnose the API bug and add a regression test"), true);
  assert.equal(isCodingRequest("What is on my schedule today?"), false);
});

test("production and destructive changes receive stronger authority gates", () => {
  assert.equal(codingRisk("inspect the repository"), "read");
  assert.equal(codingRisk("refactor the parser"), "write");
  assert.equal(codingRisk("deploy this fix to production"), "high");
  assert.equal(codingRisk("drop the production database"), "critical");
  assert.equal(codingAuthority("deploy this fix to production").requiresApprovalBeforeMutation, true);
  assert.equal(codingAuthority("drop the production database").destructiveActionAllowed, false);
});

test("coding prompt requires inspection, tests, diff review, and truthful completion", () => {
  const prompt = codingRuntimePrompt("fix the TypeScript API bug");
  assert.match(prompt, /Inspect repository instructions/);
  assert.match(prompt, /regression tests/);
  assert.match(prompt, /Review the final diff/);
  assert.match(prompt, /Never claim fixed/);
});

test("a patch is not verified without passing checks", () => {
  assert.equal(assessCodingEvidence({ changedFiles: ["src/a.js"], checks: [] }).mayClaimFixed, false);
  assert.equal(assessCodingEvidence({ changedFiles: ["src/a.js"], checks: [{ kind: "test", status: "passed" }] }).mayClaimFixed, true);
  assert.equal(assessCodingEvidence({ changedFiles: ["src/a.js"], checks: [{ kind: "test", status: "failed" }] }).terminalState, "blocked");
});

test("deployment claims require deployment evidence", () => {
  const result = assessCodingEvidence({ deployed: true, changedFiles: ["src/a.js"], checks: [{ kind: "test", status: "passed" }] });
  assert.equal(result.mayClaimFixed, false);
  assert.equal(result.mayClaimDeployed, false);
});
