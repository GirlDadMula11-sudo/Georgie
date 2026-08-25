import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createGovernedConnector, normalizeConnectorState, validateCommandEnvelope, summarizeGovernedMacJob } from "../src/governed-connector.js";

function harness(options = {}, shared = null) {
  const box = shared || { state: { schema: "georgie.governed-connector.v1", version: 1, commands: [], events: [], receipts: [], updatedAt: null } };
  const connector = createGovernedConnector({ ...options, readState: async () => structuredClone(box.state), writeState: async (_userId, next) => { box.state = structuredClone(next); }, retainObjective: async () => ({ id: "node-1" }), transitionObjective: async () => ({ id: "node-1" }) });
  connector.__box = box;
  return connector;
}
async function waitFor(connector, userId, commandId, statuses = ["completed", "blocked", "recovering"], timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await connector.status(userId, commandId); if (value && statuses.includes(value.status)) return value; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error("Timed out waiting for " + commandId + ": " + statuses.join(","));
}

test("connector requires idempotency and binds approval IDs", () => {
  assert.throws(() => validateCommandEnvelope({ command: "continue" }), /idempotency/i);
  assert.throws(() => validateCommandEnvelope({ kind: "approval", command: "approve", idempotencyKey: "one" }), /planId and approvalId/i);
  const value = validateCommandEnvelope({ kind: "approval", command: "approve", idempotencyKey: "one", planId: "plan-1", approvalId: "approval-1" });
  assert.equal(value.kind, "approval"); assert.equal(value.planId, "plan-1"); assert.equal(value.approvalId, "approval-1");
});

test("connector dispatches once and returns objective and evidence receipts", async () => {
  let calls = 0; const statuses = [];
  const connector = harness({ executeCommand: async ({ connector: context }) => { calls += 1; return { text: "Verified", terminalState: "completed", context }; }, emitStatus: async (event) => statuses.push(event.status) });
  const input = { source: "chatgpt", idempotencyKey: `test-${Date.now()}`, objectiveId: "shared-objective-1", command: "Inspect the Sierra evidence ledger" };
  const first = await connector.submit("connector-test", input); const second = await connector.submit("connector-test", input);
  assert.equal(first.status, "accepted"); assert.equal(first.objectiveId, "shared-objective-1"); assert.match(first.receipt.receiptId, /^rcpt_/); assert.match(first.lease.id, /^lease_/);
  assert.equal(second.duplicate, true); assert.equal(second.commandId, first.commandId);
  const stored = await waitFor(connector, "connector-test", first.commandId, ["completed"]); assert.equal(calls, 1); assert.equal(stored.status, "completed"); assert.ok(stored.receipts.length >= 3); assert.deepEqual(statuses, ["accepted", "running", "completed"]);
});

test("typed connector results remain available through the return channel", async () => {
  const connector = harness({ executeCommand: async () => assert.fail("typed command entered prose router") });
  const first = await connector.submit("typed-result-return", mailboxEnvelope({ idempotencyKey: "typed-result-return-1" }));
  const stored = await waitFor(connector, "typed-result-return", first.commandId, ["recovering"]);
  assert.equal(stored.result.route.target_device, "primary-mac");
  assert.equal(stored.result.job.authority, "read_only");
});

test("failed work remains resumable under the same command ID", async () => {
  let fail = true; const connector = harness({ executeCommand: async () => { if (fail) throw new Error("temporary outage"); return { terminalState: "completed" }; } });
  const input = { source: "chatgpt", idempotencyKey: `resume-${Date.now()}`, command: "Resume the bounded investigation" };
  const first = await connector.submit("connector-resume-test", input); await waitFor(connector, "connector-resume-test", first.commandId, ["recovering"]);
  fail = false; const resumed = await connector.resume("connector-resume-test"); assert.equal(resumed.length, 1); assert.equal(resumed[0].commandId, first.commandId); await waitFor(connector, "connector-resume-test", first.commandId, ["completed"]);
});

test("legacy or partial durable state normalizes before command processing", async () => {
  assert.deepEqual(normalizeConnectorState({ schema: "legacy", commands: null, unrelated: true }), {
    schema: "georgie.governed-connector.v1",
    version: 2,
    commands: [],
    leases: [],
    events: [],
    receipts: [],
    updatedAt: null,
    unrelated: true
  });
});

const mailboxEnvelope = (overrides = {}) => ({
  source: "chatgpt",
  objectiveId: "SIERRA-LI-MBX-20260823-001",
  idempotencyKey: "mailbox-route-1",
  command: "Resume mailbox evidence certification; rejected CM-100 receipts remain unrelated.",
  metadata: {
    capability: "primary_mac.mailbox.read_only",
    target_device: "primary-mac",
    operation: "connection_verify_and_backfill",
    authority: "read_only",
    prohibited_routes: ["cm-100", "sierra.continue_diagnostic_investigation"],
    mailboxes: ["mailbox-one@sierramarketinginc.com", "mailbox-two@sierramarketinginc.com"],
    batchLimit: 25
  },
  ...overrides
});

test("mailbox commands match only the primary Mac read-only capability", () => {
  const envelope = validateCommandEnvelope(mailboxEnvelope());
  assert.deepEqual(envelope.routing, {
    objective_id: "SIERRA-LI-MBX-20260823-001",
    capability: "primary_mac.mailbox.read_only",
    target_device: "primary-mac",
    operation: "connection_verify_and_backfill",
    authority: "read_only",
    idempotency_key: "mailbox-route-1",
    prohibited_routes: ["cm-100", "sierra.continue_diagnostic_investigation"]
  });
});

test("MCP-safe nested command envelopes route deterministically", () => {
  const envelope = validateCommandEnvelope({
    source: "openai",
    objectiveId: "SIERRA-LI-MBX-20260823-001",
    idempotencyKey: "nested-mailbox-route",
    command: "Continue the existing mailbox objective.",
    metadata: { command_envelope: {
      objective_id: "SIERRA-LI-MBX-20260823-001",
      capability: "neo_mailbox_evidence_bridge",
      target_device: "primary-mac",
      operation: "connection_verify_and_backfill",
      authority: "read_only",
      idempotency_key: "nested-mailbox-route",
      prohibited_routes: ["cm-100", "stale_continuation", "gmail", "apple_mail"]
    } }
  });
  assert.equal(envelope.routing.capability, "neo_mailbox_evidence_bridge");
  assert.equal(envelope.routing.target_device, "primary-mac");
  assert.equal(envelope.routing.authority, "read_only");
});

test("CM-100 prose cannot capture a typed mailbox objective", async () => {
  let proseCalls = 0;
  const connector = harness({ executeCommand: async () => { proseCalls += 1; return { terminalState: "completed" }; } });
  const result = await connector.submit("typed-mailbox-route", mailboxEnvelope());
  assert.equal(proseCalls, 0);
  const stored = await waitFor(connector, "typed-mailbox-route", result.commandId, ["recovering"]);
  assert.equal(stored.result.route.capability, "primary_mac.mailbox.read_only");
  assert.equal(stored.result.job.deviceId, "primary-mac");
  assert.equal(stored.result.job.authority, "read_only");
});

test("duplicate typed commands create one logical execution", async () => {
  const connector = harness({ executeCommand: async () => assert.fail("typed command entered prose router") });
  const first = await connector.submit("typed-mailbox-dedupe", mailboxEnvelope());
  const second = await connector.submit("typed-mailbox-dedupe", mailboxEnvelope());
  assert.equal(second.duplicate, true);
  assert.equal(second.commandId, first.commandId);
  assert.equal(second.objectiveId, first.objectiveId);
});

test("unsupported capabilities and mismatched authority fail explicitly", () => {
  assert.throws(() => validateCommandEnvelope(mailboxEnvelope({ metadata: { ...mailboxEnvelope().metadata, capability: "sierra.deal" } })), /UNSUPPORTED_CAPABILITY/);
  assert.throws(() => validateCommandEnvelope(mailboxEnvelope({ metadata: { ...mailboxEnvelope().metadata, authority: "write" } })), /CAPABILITY_AUTHORITY_MISMATCH/);
});

test("developer typed capabilities are exact, allowlisted, and approval separated", () => {
  const base={source:"openai",objectiveId:"obj-engineering",idempotencyKey:"dev-inspect-1",command:"Inspect",metadata:{capability:"developer.repository_inspection",target_device:"primary-mac",operation:"inspect",authority:"read_only",repo:"/Users/mac/Georgie",prohibited_routes:["email.send","production.deploy"]}};
  assert.equal(validateCommandEnvelope(base).routing.capability,"developer.repository_inspection");
  assert.throws(()=>validateCommandEnvelope({...base,metadata:{...base.metadata,authority:"approved_exact_patch"}}),/CAPABILITY_AUTHORITY_MISMATCH/);
  const apply={...base,kind:"approval",planId:"plan-1",approvalId:"approval-1",idempotencyKey:"dev-apply-1",metadata:{...base.metadata,capability:"developer.patch_application",operation:"apply_hash_bound_patch",authority:"approved_exact_patch",patch:"diff --git a/a b/a",patch_hash:"bad"}};
  assert.equal(validateCommandEnvelope(apply).routing.capability,"developer.patch_application");
});

test("Sierra mailbox projection is a separate typed evidence-write capability", () => {
  const input={source:"chatgpt",objectiveId:"SIERRA-LI-MBX-20260823-001",idempotencyKey:"project-mailbox-evidence-1",command:"Project immutable receipts.",metadata:{capability:"sierra.mailbox_evidence.project",target_device:"server",operation:"project_immutable_receipts",authority:"evidence_write",prohibited_routes:["email.send","smtp","mailbox.write","external.notification","lender.submit"],receipt_ids:["rcpt_one"]}};
  const envelope=validateCommandEnvelope(input);
  assert.equal(envelope.routing.capability,"sierra.mailbox_evidence.project");
  assert.equal(envelope.routing.authority,"evidence_write");
  assert.throws(()=>validateCommandEnvelope({...input,metadata:{...input.metadata,authority:"read_only"}}),/CAPABILITY_AUTHORITY_MISMATCH/);
  assert.throws(()=>validateCommandEnvelope({...input,metadata:{...input.metadata,prohibited_routes:["email.send","arbitrary"]}}),/UNKNOWN_PROHIBITED_ROUTE/);
});

test("primary Mac maintenance is exact, bounded, and cannot enter mailbox routes", async () => {
  const input = {
    source: "chatgpt",
    objectiveId: "SIERRA-LI-MBX-20260823-001",
    idempotencyKey: `mac-self-update-${Date.now()}`,
    command: "Update and restart the local Georgie agent, then resume the existing objective.",
    metadata: {
      capability: "primary_mac.agent.maintenance",
      target_device: "primary-mac",
      operation: "update_restart_from_main",
      authority: "local_admin",
      prohibited_routes: ["cm-100", "stale_continuation", "gmail", "apple_mail", "mailbox.read", "mailbox.write"],
      repo: "/Users/mac/Georgie",
      expected_agent_version: "2.2.5"
    }
  };
  const envelope = validateCommandEnvelope(input);
  assert.equal(envelope.routing.capability, "primary_mac.agent.maintenance");
  assert.equal(envelope.routing.authority, "local_admin");
  const connector = harness({ executeCommand: async () => assert.fail("maintenance command entered prose router") });
  const first = await connector.submit("primary", input);
  const duplicate = await connector.submit("primary", input);
  const stored = await waitFor(connector, "primary", first.commandId, ["recovering"]);
  assert.deepEqual(stored.result.jobs.map((job) => job.action), ["developer.update_restart_from_main"]);
  assert.equal(stored.result.jobs.every((job) => job.deviceId === "primary-mac"), true);
  assert.equal(duplicate.duplicate, true);
  assert.throws(() => validateCommandEnvelope({ ...input, metadata: { ...input.metadata, operation: "connection_verify_and_backfill" } }), /UNSUPPORTED_OPERATION/);
  assert.throws(() => validateCommandEnvelope({ ...input, metadata: { ...input.metadata, authority: "read_only" } }), /CAPABILITY_AUTHORITY_MISMATCH/);
  assert.throws(() => validateCommandEnvelope({ ...input, metadata: { ...input.metadata, prohibited_routes: ["mailbox.read", "cm-100", "arbitrary"] } }), /UNKNOWN_PROHIBITED_ROUTE/);
});

test("controlled NEO preload installation routes only to local maintenance",async()=>{
  const input={source:"chatgpt",objectiveId:"SIERRA-LI-MBX-20260823-001",idempotencyKey:"neo-preload-install-1",command:"Install the controlled pre-navigation NEO hook.",metadata:{capability:"primary_mac.agent.maintenance",target_device:"primary-mac",operation:"install_neo_preload",authority:"local_admin",prohibited_routes:["cm-100","stale_continuation","gmail","apple_mail","mailbox.read","mailbox.write"],repo:"/Users/mac/Georgie"}};
  const connector=harness({executeCommand:async()=>assert.fail("maintenance command entered prose router")});
  const result=await connector.submit("primary-preload",input);
  const stored = await waitFor(connector, "primary-preload", result.commandId, ["recovering"]);
  assert.deepEqual(stored.result.jobs.map(job=>job.action),["developer.install_neo_preload"]);
  assert.equal(stored.result.route.target_device,"primary-mac");
});

test("Mac self-update source only permits generated package-lock version drift cleanup",()=>{
  const source=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  assert.match(source,/status\.stdout\.trim\(\) === "M package-lock\.json"/);
  assert.match(source,/generatedVersionOnly/);
  assert.match(source,/changed\.length <= 4/);
  assert.match(source,/git", \["-C", repo, "restore", "--", "package-lock\.json"\]/);
  assert.match(source,/PRIMARY_MAC_REPO_DIRTY/);
});

test("generated lock normalization is an exact local patch route",async()=>{
  const input={source:"chatgpt",objectiveId:"SIERRA-LI-MBX-20260823-001",idempotencyKey:"normalize-lock-1",command:"Normalize generated lock drift.",metadata:{capability:"primary_mac.agent.maintenance",target_device:"primary-mac",operation:"normalize_generated_lock",authority:"local_admin",prohibited_routes:["cm-100","stale_continuation","gmail","apple_mail","mailbox.read","mailbox.write"],repo:"/Users/mac/Georgie"}};
  const connector=harness({executeCommand:async()=>assert.fail("maintenance entered prose router")});
  const result=await connector.submit("normalize-lock",input);
  const stored = await waitFor(connector, "normalize-lock", result.commandId, ["recovering"]);
  assert.deepEqual(stored.result.jobs.map(job=>job.action),["developer.apply_patch"]);
  assert.equal(stored.result.route.operation,"normalize_generated_lock");
});

test("interruption resumes the same objective and step", async () => {
  let fail = true;
  const connector = harness({ executeCommand: async () => { if (fail) throw new Error("interrupted"); return { terminalState: "completed" }; } });
  const input = { source: "chatgpt", objectiveId: "objective-resume", idempotencyKey: "resume-same-step", command: "continue" };
  const first = await connector.submit("objective-isolation", input);
  await waitFor(connector, "objective-isolation", first.commandId, ["recovering"]);
  fail = false;
  const resumed = await connector.resume("objective-isolation");
  assert.equal(resumed[0].commandId, first.commandId);
  assert.equal(resumed[0].objectiveId, "objective-resume");
  await waitFor(connector, "objective-isolation", first.commandId, ["completed"]);
});


test("typed NEO contract inspection is diagnostic-only and cannot dispatch mailbox backfill", async()=>{
  const input=mailboxEnvelope({idempotencyKey:"neo-static-contract-1",metadata:{...mailboxEnvelope().metadata,capability:"neo_mailbox_evidence_bridge",operation:"static_contract_inspection",prohibited_routes:["cm-100","stale_continuation","gmail","apple_mail"]}});
  const envelope=validateCommandEnvelope(input);
  assert.equal(envelope.routing.operation,"static_contract_inspection");
  const connector=harness({executeCommand:async()=>assert.fail("typed inspection entered prose router")});
  const result=await connector.submit("neo-static-contract",input);
  const stored = await waitFor(connector, "neo-static-contract", result.commandId, ["recovering"]);
  assert.equal(stored.result.job.action,"mailbox.neo_static_contract_inspect");
  assert.equal(stored.result.job.authority,"read_only");
  assert.notEqual(stored.result.job.action,"mailbox.read_only_backfill");
});


test("completed NEO static contract diagnostics survive the governed return channel",()=>{
  const inspection={provider:"neo_static_bundle_contracts",objectiveId:"SIERRA-LI-MBX-20260823-001",authorizationBlocked:true,contracts:[{transport:"https",origin:"https://api.neo.example",path:"/mail/messages"}]};
  const summary=summarizeGovernedMacJob({id:"job-1",status:"completed",action:"mailbox.neo_static_contract_inspect",args:{authority:"read_only"},result:{neoStaticContractInspection:inspection}});
  assert.deepEqual(summary.staticContractInspection,inspection);
  assert.equal(summary.packetCount,0);
  assert.equal(summary.authority,"read_only");
});


const seoEnvelope = (overrides = {}) => ({
  source: "chatgpt",
  objectiveId: "SIERRA-SEO-20260824-GEORGIE-001",
  idempotencyKey: "seo-discovery-baseline-1",
  command: "Execute the bounded Sierra SEO discovery baseline.",
  metadata: {
    capability: "sierra.seo.workflow",
    target_device: "server",
    operation: "discovery_baseline",
    authority: "read_only",
    prohibited_routes: ["sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation", "sierra.deal", "sierra.reprocess_documents", "email.send", "lender.submit", "dns.write", "production.deploy"],
    max_pages: 150,
    pagespeed_limit: 5
  },
  ...overrides
});

test("typed SEO workflow resolves only to the server-side SEO contract", () => {
  const envelope = validateCommandEnvelope(seoEnvelope());
  assert.deepEqual(envelope.routing, {
    objective_id: "SIERRA-SEO-20260824-GEORGIE-001",
    capability: "sierra.seo.workflow",
    target_device: "server",
    operation: "discovery_baseline",
    authority: "read_only",
    idempotency_key: "seo-discovery-baseline-1",
    prohibited_routes: ["sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation", "sierra.deal", "sierra.reprocess_documents", "email.send", "lender.submit", "dns.write", "production.deploy"]
  });
});

test("SEO workflow fails closed instead of falling into deal diagnostics", () => {
  assert.throws(() => validateCommandEnvelope(seoEnvelope({ metadata: { ...seoEnvelope().metadata, operation: "resume_unblock_and_execute" } })), /UNSUPPORTED_OPERATION/);
  assert.throws(() => validateCommandEnvelope(seoEnvelope({ metadata: { ...seoEnvelope().metadata, target_device: "primary-mac" } })), /CAPABILITY_TARGET_MISMATCH/);
  assert.throws(() => validateCommandEnvelope(seoEnvelope({ metadata: { ...seoEnvelope().metadata, authority: "evidence_write" } })), /CAPABILITY_AUTHORITY_MISMATCH/);
});


test("typed SEO evidence survives the durable connector return channel", () => {
  const source = fs.readFileSync(new URL("../src/governed-connector.js", import.meta.url), "utf8");
  for (const field of ["integration:result?.integration", "websiteControl:result?.websiteControl", "crawl:result?.crawl", "performance:Array.isArray", "applicationFunnel:result?.applicationFunnel", "defects:result?.defects"]) assert.match(source, new RegExp(field.replaceAll("?", "\\?").replaceAll(".", "\\.")));
});


const governedMacBrowserEnvelope = (overrides = {}) => ({
  source: "chatgpt",
  objectiveId: "SIERRA-SEO-MAC-BROWSER-20260824-001",
  idempotencyKey: "governed-mac-browser-inspect-1",
  command: "Inspect the approved Sierra WordPress and Hostinger browser session.",
  metadata: {
    capability: "primary_mac.browser.wordpress_read_only",
    target_device: "primary-mac",
    operation: "inspect_session",
    authority: "read_only",
    prohibited_routes: ["arbitrary_domain", "credentials.read", "form.submit", "content.write", "wordpress.publish", "dns.write", "email.send"],
    site_origin: "https://sierramarketinginc.com"
  },
  ...overrides
});

test("dedicated governed Mac browser capability is typed, allowlisted, and read-only", async () => {
  const envelope = validateCommandEnvelope(governedMacBrowserEnvelope());
  assert.equal(envelope.routing.capability, "primary_mac.browser.wordpress_read_only");
  assert.equal(envelope.routing.target_device, "primary-mac");
  assert.equal(envelope.routing.authority, "read_only");
  const connector = harness({ executeCommand: async () => assert.fail("governed browser command entered prose router") });
  const result = await connector.submit("primary", governedMacBrowserEnvelope());
  const stored = await waitFor(connector, "primary", result.commandId, ["recovering"]);
  assert.equal(stored.result.job.action, "browser.wordpress_hostinger_inspect");
  assert.equal(stored.result.job.authority, "read_only");
  assert.throws(() => validateCommandEnvelope(governedMacBrowserEnvelope({ metadata: { ...governedMacBrowserEnvelope().metadata, authority: "write" } })), /CAPABILITY_AUTHORITY_MISMATCH/);
  assert.throws(() => validateCommandEnvelope(governedMacBrowserEnvelope({ metadata: { ...governedMacBrowserEnvelope().metadata, operation: "publish" } })), /UNSUPPORTED_OPERATION/);
  assert.throws(() => validateCommandEnvelope(governedMacBrowserEnvelope({ metadata: { ...governedMacBrowserEnvelope().metadata, prohibited_routes: ["arbitrary_domain", "mouse.unrestricted"] } })), /UNKNOWN_PROHIBITED_ROUTE/);
});

test("Mac browser handler filters domains, redacts credentials, and cannot mutate", () => {
  const source = fs.readFileSync(new URL("../mac-agent/agent.js", import.meta.url), "utf8");
  assert.match(source, /GOVERNED_WORDPRESS_BROWSER_HOSTS.*sierramarketinginc\.com.*hostinger\.com/);
  assert.match(source, /formValuesCaptured: false/);
  assert.match(source, /credentialsTransferred: false/);
  assert.match(source, /mutationPerformed: false/);
  assert.match(source, /GOVERNED_BROWSER_SITE_REJECTED/);
});
