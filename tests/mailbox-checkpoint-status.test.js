import test from "node:test";
import assert from "node:assert/strict";
import { validateCommandEnvelope } from "../src/governed-connector.js";

const base = {
  source: "chatgpt",
  objectiveId: "SIERRA-LI-MBX-20260823-001",
  idempotencyKey: "mailbox-checkpoint-status-test",
  command: "Read the durable mailbox checkpoint only.",
  metadata: {
    capability: "sierra.mailbox_evidence.project",
    target_device: "server",
    operation: "checkpoint_status",
    authority: "read_only",
    prohibited_routes: ["email.send", "smtp", "mailbox.write", "external.notification", "lender.submit"]
  }
};

test("Sierra mailbox checkpoint/status is server read-only", () => {
  const envelope = validateCommandEnvelope(base);
  assert.equal(envelope.routing.capability, "sierra.mailbox_evidence.project");
  assert.equal(envelope.routing.target_device, "server");
  assert.equal(envelope.routing.operation, "checkpoint_status");
  assert.equal(envelope.routing.authority, "read_only");
  assert.throws(() => validateCommandEnvelope({ ...base, metadata: { ...base.metadata, authority: "evidence_write" } }), /CAPABILITY_AUTHORITY_MISMATCH/);
});

test("Sierra mailbox evidence projection remains evidence-write only", () => {
  const projection = {
    ...base,
    idempotencyKey: "mailbox-projection-authority-test",
    command: "Project immutable receipts.",
    metadata: {
      ...base.metadata,
      operation: "project_immutable_receipts",
      authority: "evidence_write",
      receipt_ids: ["rcpt_one"]
    }
  };
  const envelope = validateCommandEnvelope(projection);
  assert.equal(envelope.routing.authority, "evidence_write");
  assert.throws(() => validateCommandEnvelope({ ...projection, metadata: { ...projection.metadata, authority: "read_only" } }), /CAPABILITY_AUTHORITY_MISMATCH/);
});
