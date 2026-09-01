import test from "node:test";
import assert from "node:assert/strict";
import { isExplicitConversationalApproval } from "../src/approval-language.js";
import { deterministicToolPlan, deterministicToolPlanWithHistory, latestDeterministicApprovalPlan } from "../src/fast-intents.js";
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

test("an already-approved email follow-up reconstructs the exact draft and bypasses memory search", () => {
  const history=[{role:"assistant",content:`I have the approved message ready for Recipient at **recipient@example.com**, but it has **not been sent**.\n\n**Prepared message**  \n**Subject:** Approved follow-up\n\nHi Recipient,\n\nThis is the exact retained test message.\n\nThank you,  \nGeorgie\n\nYour approval is already clear. The remaining step is the actual provider send.`}];
  const actions=deterministicToolPlanWithHistory("Send the approved message now; I already approved it.",history);
  assert.deepEqual(actions.map(item=>item.tool),["approvals.prepare_plan","approvals.continue_latest"]);
  const plan=actions[0].args;
  assert.equal(plan.execution.tool,"email.send");
  assert.equal(plan.execution.args.to,"recipient@example.com");
  assert.equal(plan.execution.args.subject,"Approved follow-up");
  assert.match(plan.execution.args.text,/Hi Recipient/);
  assert.doesNotMatch(plan.execution.args.text,/Your approval is already clear/);
  assert.match(plan.execution.idempotencyKey,/^approved-email:[0-9a-f]{32}$/);
  assert.equal(actions.some(item=>item.tool==="memory.search"),false);
  assert.equal(latestDeterministicApprovalPlan(history)?.args?.execution?.idempotencyKey,plan.execution.idempotencyKey);
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
