import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateCapabilityRequest } from "../src/capability-orchestrator.js";

const contract = ({ targetDevice, authority, operations, prohibitedRoutes = [], authorityByOperation = null }) => ({
  targetDevice,
  authority,
  authorityByOperation: authorityByOperation || undefined,
  operations: new Set(operations),
  prohibitedRoutes: new Set(prohibitedRoutes)
});

const contracts = {
  "developer.repository_inspection": contract({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: ["inspect", "read_file"],
    prohibitedRoutes: ["email.send", "smtp", "mailbox.write", "lender.submit", "production.deploy"]
  }),
  "developer.patch_preparation": contract({
    targetDevice: "primary-mac",
    authority: "prepare_only",
    operations: ["prepare_hash_bound_patch", "run_allowlisted_checks"],
    prohibitedRoutes: ["email.send", "smtp", "mailbox.write", "lender.submit", "production.deploy"]
  }),
  "neo_mail.imap.read_only": contract({
    targetDevice: "server",
    authority: "read_only",
    operations: ["connection_verify_and_backfill"],
    prohibitedRoutes: ["email.send", "smtp", "mailbox.write", "gmail", "apple_mail"]
  })
};

test("exact supported capability remains unchanged", () => {
  const result = orchestrateCapabilityRequest({ capability: "developer.repository_inspection", targetDevice: "primary-mac", operation: "inspect", authority: "read_only", prohibitedRoutes: ["production.deploy"], command: "Inspect Georgie" }, contracts);
  assert.equal(result.status, "exact");
  assert.equal(result.route.capability, "developer.repository_inspection");
});

test("unsupported engineering capability never falls back to read-only inspection", () => {
  const result = orchestrateCapabilityRequest({ capability: "developer.control_plane", targetDevice: "georgie-runtime", operation: "upgrade_core_operator", authority: "low-risk-reversible-engineering", prohibitedRoutes: [], command: "Upgrade and strengthen Georgie core reliability and orchestration" }, contracts);
  assert.equal(result.status, "unsupported");
  assert.equal(result.route.capability, "developer.control_plane");
  assert.equal(result.route.operation, "upgrade_core_operator");
  assert.match(result.audit.missingPrerequisite, /registered executor for developer\.control_plane\/upgrade_core_operator/);
  assert.equal(result.audit.authorityEscalated, false);
});

test("orchestration does not substitute a different capability with the same operation", () => {
  const result = orchestrateCapabilityRequest({ capability: "mailbox.reader", targetDevice: "server", operation: "connection_verify_and_backfill", authority: "read_only", prohibitedRoutes: ["email.send"], command: "Resume mailbox backfill" }, contracts);
  assert.equal(result.status, "unsupported");
  assert.equal(result.route.capability, "mailbox.reader");
});

test("orchestrator never escalates write authority to make an unsupported request succeed", () => {
  const result = orchestrateCapabilityRequest({ capability: "developer.control_plane", targetDevice: "georgie-runtime", operation: "upgrade_core_operator", authority: "approved_exact_patch", prohibitedRoutes: [], command: "Upgrade Georgie" }, contracts);
  assert.equal(result.status, "unsupported");
  assert.equal(result.audit.authorityEscalated, false);
});

test("requested prohibitions must be preservable before reformulation", () => {
  const result = orchestrateCapabilityRequest({ capability: "developer.control_plane", targetDevice: "georgie-runtime", operation: "upgrade_core_operator", authority: "read_only", prohibitedRoutes: ["credentials.read"], command: "Inspect Georgie reliability" }, contracts);
  assert.equal(result.status, "unsupported");
});
