import test from "node:test";
import assert from "node:assert/strict";
import { isExplicitConversationalApproval } from "../src/approval-language.js";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { preflightExecution } from "../src/approval-continuation.js";
import { listToolDefinitions } from "../src/tools.js";

test("natural approval with a request for the send receipt resumes the governed plan", () => {
  const utterance = "Approved please let me know when it’s sent";
  assert.equal(isExplicitConversationalApproval(utterance), true);
  assert.deepEqual(deterministicToolPlan(utterance), [
    { tool: "approvals.continue_latest", args: { utterance } }
  ]);
});

test("an approved email plan preflights against the attached production tool registry", () => {
  const execution = {
    tool: "email.send",
    args: {
      mailboxId: "work",
      to: "recipient@example.com",
      subject: "Payment reminder",
      text: "This is a bounded test fixture and is never sent."
    }
  };
  const result = preflightExecution(execution, listToolDefinitions());
  assert.equal(result.ok, true);
  assert.deepEqual(result.requiredTools, ["email.send"]);
});
