import test from "node:test";
import assert from "node:assert/strict";
import { neoMailInternals, neoHumanEscalationDisclosure } from "../src/integrations/neo-mail.js";
import { buildDocumentReceiptReply, containsBindingOrFinancialCommitment, isSafeAutomaticClientReply } from "../src/client-correspondence.js";
import { classifyCorrespondenceAttachment } from "../src/integrations/sierra-correspondence.js";

test("business NEO disclosure is inserted before signature exactly once", () => {
  const input = "We received your documents.\n\nBest,\nGeorgie\nSierra Capital Advisory";
  const output = neoMailInternals.insertDisclosureBeforeSignature(input);
  assert.match(output, new RegExp(neoHumanEscalationDisclosure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(output.indexOf(neoHumanEscalationDisclosure) < output.indexOf("Best,"));
  assert.equal(neoMailInternals.insertDisclosureBeforeSignature(output), output);
});

test("automatic correspondence blocks binding and financial commitment language", () => {
  assert.equal(containsBindingOrFinancialCommitment("We received your bank statements and updated your file."), false);
  assert.equal(containsBindingOrFinancialCommitment("I accept the final factor rate and authorize funding."), true);
});

test("document receipt reply is deterministic from authoritative open requests", () => {
  const text = buildDocumentReceiptReply({ receivedCount: 2, requests: [
    { document_type: "June bank statement", instructions: "Please send the complete PDF." },
    { document_type: "Signed application", instructions: "All pages required." }
  ]});
  assert.match(text, /received 2 documents/i);
  assert.match(text, /June bank statement/);
  assert.match(text, /Signed application/);
  assert.doesNotMatch(text, /rate|factor|approval/i);
});

test("only exact client-email matches qualify for routine automatic replies", () => {
  const base = { triage: { category: "document_request", confidence: 0.95 }, text: "We received your documents.", openRequests: [{ id: "r1" }], receivedCount: 1 };
  assert.equal(isSafeAutomaticClientReply({ ...base, target: { ok: true, match_method: "client_email", client_email: "client@example.com" } }), true);
  assert.equal(isSafeAutomaticClientReply({ ...base, target: { ok: true, match_method: "content_identity", client_email: "client@example.com" } }), false);
  assert.equal(isSafeAutomaticClientReply({ ...base, text: "We accept the final terms.", target: { ok: true, match_method: "client_email", client_email: "client@example.com" } }), false);
});

test("NEO attachments classify conservatively for Sierra intake", () => {
  assert.equal(classifyCorrespondenceAttachment({ filename: "June-2026-Bank-Statement.pdf" }).documentType, "bank_statement");
  assert.equal(classifyCorrespondenceAttachment({ filename: "Signed-Funding-Application.pdf" }).documentType, "application");
  assert.equal(classifyCorrespondenceAttachment({ filename: "voided-check.pdf" }).documentType, "supporting_document");
});
