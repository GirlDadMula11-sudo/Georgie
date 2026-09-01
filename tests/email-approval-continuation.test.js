import test from "node:test";
import assert from "node:assert/strict";
import { isExplicitConversationalApproval } from "../src/approval-language.js";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { preflightExecution } from "../src/approval-continuation.js";
import { approvalDispatchReceipt, isApprovalDispatchTool, listToolDefinitions } from "../src/tools.js";
import { verifyBusinessOutcome } from "../src/outcome-verification.js";

test("natural approval with a request for the send receipt resumes the governed plan", () => {
  const utterance = "Approved please let me know when it’s sent";
  assert.equal(isExplicitConversationalApproval(utterance), true);
  assert.deepEqual(deterministicToolPlan(utterance), [
    { tool: "approvals.continue_latest", args: { utterance } }
  ]);
});

test("email approval recovery is dispatchable and requires the real SMTP receipt", () => {
  assert.equal(isApprovalDispatchTool("email.send"), true);
  assert.throws(() => approvalDispatchReceipt("email.send", { accepted: ["recipient@example.com"] }), /verified delivery-acceptance receipt/);
  assert.throws(() => approvalDispatchReceipt("email.send", { messageId: "provider-1", accepted: [] }), /verified delivery-acceptance receipt/);
  const receipt = approvalDispatchReceipt("email.send", {
    messageId: "provider-1",
    accepted: ["recipient@example.com"],
    rejected: [],
    mailboxId: "work",
    idempotencyKey: "approval:one:plan:one"
  });
  assert.equal(receipt.provider, "smtp");
  assert.equal(receipt.messageId, "provider-1");
  assert.deepEqual(receipt.accepted, ["recipient@example.com"]);
  assert.equal(receipt.idempotencyKey, "approval:one:plan:one");
  assert.equal(verifyBusinessOutcome("email.send", { messageId: "provider-1", accepted: ["recipient@example.com"], rejected: [] }).accepted, true);
  assert.equal(verifyBusinessOutcome("email.send", { accepted: ["recipient@example.com"] }).accepted, false);
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
