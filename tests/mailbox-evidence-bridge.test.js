import test from "node:test";
import assert from "node:assert/strict";
import { validateMailboxEvidencePacket } from "../src/mailbox-evidence-bridge.js";

const base = (overrides={}) => ({ objectiveId:"SIERRA-LI-MBX-20260823-001", batchId:"batch-1", packetId:"packet-1", mailbox:"mailbox-one@sierramarketinginc.com", messageId:"message-1", threadId:"thread-1", timestamp:"2026-08-23T05:00:00.000Z", senderDomains:["lender.example"], recipientDomains:["sierramarketinginc.com"], normalizedSubject:"Approval for Example LLC", dealCandidates:["Example LLC"], lenderCandidates:["Example Lender"], evidenceClass:"authoritative_lender_outcome", outcome:{decision:"approved",account:"123456789"}, attachmentHashes:["a".repeat(64)], sourceLocator:"local-mail://mailbox/message/message-1", confidence:0.9, conflicts:[], excerpt:"SSN 123-45-6789 DOB 01/02/1990 EIN 12-3456789", bodyHash:"b".repeat(64), bodyComplete:true, retrievalMethod:"guarded_dom_open", readStateProof:{before:"unread",after:"unread",neutral:true,transportPolicy:"same_origin_get_head_only",blockedMutationCount:1}, credentialsTransferred:false, mailboxMutation:false, observedAt:"2026-08-23T05:01:00.000Z", ...overrides });

test("bridge authorizes the exact objective and mailbox scope",()=>{
  const packet=validateMailboxEvidencePacket(base(),{objectiveId:"SIERRA-LI-MBX-20260823-001",mailboxes:["mailbox-one@sierramarketinginc.com"]});
  assert.match(packet.packetHash,/^[a-f0-9]{64}$/);assert.equal(packet.mailbox,"mailbox-one@sierramarketinginc.com");
});

test("bridge rejects cross-objective and cross-mailbox packets",()=>{
  assert.throws(()=>validateMailboxEvidencePacket(base(),{objectiveId:"different",mailboxes:[base().mailbox]}),/OBJECTIVE_MISMATCH/);
  assert.throws(()=>validateMailboxEvidencePacket(base({mailbox:"other@example.com"}),{objectiveId:base().objectiveId,mailboxes:["other@example.com"]}),/SCOPE_MISMATCH/);
});

test("bridge rejects malformed or tampered packets",()=>{
  assert.throws(()=>validateMailboxEvidencePacket(base({messageId:""}),{objectiveId:base().objectiveId,mailboxes:[base().mailbox]}),/MALFORMED/);
  assert.throws(()=>validateMailboxEvidencePacket(base({packetHash:"0".repeat(64)}),{objectiveId:base().objectiveId,mailboxes:[base().mailbox]}),/HASH_MISMATCH/);
});

test("bridge refuses snippets, missing read-state proof, credentials, and mailbox mutation",()=>{
  const scope={objectiveId:base().objectiveId,mailboxes:[base().mailbox]};
  assert.throws(()=>validateMailboxEvidencePacket(base({bodyComplete:false}),scope),/FULL_BODY_READ_STATE_PROOF_REQUIRED/);
  assert.throws(()=>validateMailboxEvidencePacket(base({readStateProof:{neutral:false}}),scope),/FULL_BODY_READ_STATE_PROOF_REQUIRED/);
  assert.throws(()=>validateMailboxEvidencePacket(base({credentialsTransferred:true}),scope),/FULL_BODY_READ_STATE_PROOF_REQUIRED/);
  assert.throws(()=>validateMailboxEvidencePacket(base({mailboxMutation:true}),scope),/FULL_BODY_READ_STATE_PROOF_REQUIRED/);
});

test("bridge redacts protected identifiers before persistence",()=>{
  const packet=validateMailboxEvidencePacket(base(),{objectiveId:base().objectiveId,mailboxes:[base().mailbox]});
  assert.doesNotMatch(packet.excerpt,/123-45-6789|01\/02\/1990|12-3456789/);assert.match(packet.excerpt,/REDACTED/);
  assert.doesNotMatch(JSON.stringify(packet.outcome),/123456789/);
});

test("packet identity is stable for duplicate canonical content and changes for amendments",()=>{
  const scope={objectiveId:base().objectiveId,mailboxes:[base().mailbox]},first=validateMailboxEvidencePacket(base(),scope),duplicate=validateMailboxEvidencePacket(base(),scope),amended=validateMailboxEvidencePacket(base({excerpt:"Updated verified result"}),scope);
  assert.equal(first.packetHash,duplicate.packetHash);assert.notEqual(first.packetHash,amended.packetHash);
});
