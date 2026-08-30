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

test("unsupported engineering writes return one exact missing prerequisite", () => {
  assert.throws(() => validateCommandEnvelope({
    source:"openai",
    objectiveId:"SIERRA-CORE-RESET-20260826",
    idempotencyKey:"core-reset-write-1",
    command:"Repair and deploy the Sierra execution kernel",
    metadata:{capability:"developer.control_plane",target_device:"georgie-runtime",operation:"upgrade_core_operator",authority:"low-risk-reversible-engineering"}
  }), /EXECUTION_CAPABILITY_UNAVAILABLE: registered executor for developer\.control_plane\/upgrade_core_operator on georgie-runtime with low-risk-reversible-engineering authority/);
});



test("developer file receipts expose hashes and capability facts without source text", () => {
  const text='const AGENT_VERSION = "2.2.35";\nagentVersion=${encodeURIComponent(AGENT_VERSION)}\nasync function enableWordpressApplicationPasswords() {}\n';
  const summary=summarizeGovernedMacJob({id:"job-source",status:"completed",action:"developer.file_read",result:{repo:"/Users/mac/Georgie",path:"mac-agent/agent.js",text,readOnly:true}});
  assert.equal(summary.sourceInspection.path,"mac-agent/agent.js");
  assert.match(summary.sourceInspection.gitBlobSha,/^[a-f0-9]{40}$/);
  assert.equal(summary.sourceInspection.agentVersion,"2.2.35");
  assert.equal(summary.sourceInspection.versionAwarePolling,true);
  assert.equal(summary.sourceInspection.wordpressApplicationPasswordHandler,true);
  assert.equal("text" in summary.sourceInspection,false);
});

test("developer file receipts expose only sanitized Mac installer diagnostic fields", () => {
  const text=JSON.stringify({version:1,status:"failed",code:"INSTALLER_EXIT_1",stage:"Installing Georgie dependencies...",startedAt:"2026-08-25T18:53:27Z",observedAt:"2026-08-25T18:53:38Z",secret:"must-not-escape"});
  const summary=summarizeGovernedMacJob({id:"job-install-diagnostic",status:"completed",action:"developer.file_read",result:{repo:"/Users/mac/Georgie",path:"mac-agent/.install-diagnostic.json",text,readOnly:true}});
  assert.deepEqual(summary.sourceInspection.installDiagnostic,{version:1,status:"failed",code:"INSTALLER_EXIT_1",stage:"Installing Georgie dependencies...",startedAt:"2026-08-25T18:53:27Z",observedAt:"2026-08-25T18:53:38Z"});
  assert.equal("text" in summary.sourceInspection,false);
  assert.equal("secret" in summary.sourceInspection.installDiagnostic,false);
});

test("developer source read is exact and allowlisted", () => {
  const base={source:"openai",objectiveId:"obj-source-read",idempotencyKey:"dev-read-1",command:"Read allowlisted source",metadata:{capability:"developer.repository_inspection",target_device:"primary-mac",operation:"read_file",authority:"read_only",repo:"/Users/mac/Georgie",path:"mac-agent/agent.js",prohibited_routes:["email.send","production.deploy"]}};
  assert.equal(validateCommandEnvelope(base).routing.operation,"read_file");
  assert.equal(validateCommandEnvelope({...base,idempotencyKey:"dev-read-lock",metadata:{...base.metadata,path:"package-lock.json"}}).routing.operation,"read_file");
  assert.equal(validateCommandEnvelope({...base,idempotencyKey:"dev-read-install-diagnostic",metadata:{...base.metadata,path:"mac-agent/.install-diagnostic.json"}}).routing.operation,"read_file");
  assert.throws(()=>validateCommandEnvelope({...base,metadata:{...base.metadata,operation:"write_file"}}),/UNSUPPORTED_OPERATION/);
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

test("hash-proven installer drift normalization is one exact local patch",async()=>{
  const input={source:"chatgpt",objectiveId:"SIERRA-SEO-AUTOPILOT-20260824-001",idempotencyKey:"normalize-installer-drift-1",command:"Normalize exact installer drift.",metadata:{capability:"primary_mac.agent.maintenance",target_device:"primary-mac",operation:"normalize_installer_generated_drift",authority:"local_admin",prohibited_routes:["cm-100","stale_continuation","gmail","apple_mail","mailbox.read","mailbox.write"],repo:"/Users/mac/Georgie"}};
  const connector=harness({executeCommand:async()=>assert.fail("maintenance entered prose router")});
  const result=await connector.submit("normalize-installer-drift",input);
  const stored=await waitFor(connector,"normalize-installer-drift",result.commandId,["recovering"]);
  assert.deepEqual(stored.result.jobs.map(job=>job.action),["developer.apply_patch"]);
  assert.equal(stored.result.route.operation,"normalize_installer_generated_drift");
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

test("WordPress security receipts expose verified exact-control proof without browser data", () => {
  const summary=summarizeGovernedMacJob({id:"job-wp-security",status:"completed",action:"browser.wordpress_enable_application_passwords",result:{wordpressApplicationPasswords:{changed:false,alreadyEnabled:true,beforeChecked:false,afterChecked:false,verified:true,rollbackPerformed:false,provider:"hostinger-tools",setting:"disableAuthenticationPassword",unexpected:"drop-me"},credentialsTransferred:false,formValuesCaptured:false}});
  assert.deepEqual(summary.browserInspection,{changed:false,alreadyEnabled:true,beforeChecked:false,afterChecked:false,verified:true,rollbackPerformed:false,provider:"hostinger-tools",setting:"disableAuthenticationPassword",credentialsTransferred:true,formValuesCaptured:true});
  assert.equal("unexpected" in summary.browserInspection,false);
});

test("Mac browser handler filters domains, redacts credentials, and cannot mutate", () => {
  const source = fs.readFileSync(new URL("../mac-agent/agent.js", import.meta.url), "utf8");
  assert.match(source, /GOVERNED_WORDPRESS_BROWSER_HOSTS.*sierramarketinginc\.com.*hostinger\.com/);
  assert.match(source, /formValuesCaptured: false/);
  assert.match(source, /credentialsTransferred: false/);
  assert.match(source, /mutationPerformed: false/);
  assert.match(source, /GOVERNED_BROWSER_SITE_REJECTED/);
  const connectorSource = fs.readFileSync(new URL("../src/governed-connector.js", import.meta.url), "utf8");
  assert.match(connectorSource, /WORDPRESS_APP_PASSWORD_TERMINAL_PROOF_MISSING/);
  assert.match(connectorSource, /job\.status === "completed"/);
  assert.match(connectorSource, /credentialsTransferred === false/);
});


test("dirty-safe governed browser agent repair is an exact maintenance patch", async () => {
  const input={source:"chatgpt",objectiveId:"SIERRA-SEO-MAC-BROWSER-20260824-001",idempotencyKey:"apply-browser-agent-1",command:"Apply the exact governed browser agent patch.",metadata:{capability:"primary_mac.agent.maintenance",target_device:"primary-mac",operation:"apply_governed_browser_agent",authority:"local_admin",prohibited_routes:["cm-100","stale_continuation","gmail","apple_mail","mailbox.read","mailbox.write"],repo:"/Users/mac/Georgie"}};
  const connector=harness({executeCommand:async()=>assert.fail("maintenance entered prose router")});
  const result=await connector.submit("primary-browser-repair",input);
  const stored=await waitFor(connector,"primary-browser-repair",result.commandId,["recovering"]);
  assert.deepEqual(stored.result.jobs.map(job=>job.action),["developer.apply_patch"]);
  assert.equal(stored.result.route.operation,"apply_governed_browser_agent");
  assert.throws(()=>validateCommandEnvelope({...input,metadata:{...input.metadata,operation:"overwrite_repository"}}),/UNSUPPORTED_OPERATION/);
});


test("dirty-safe SEO JSON boundary repair is an exact maintenance patch", async () => {
  const input={source:"chatgpt",objectiveId:"SIERRA-SEO-20260824-GEORGIE-001",idempotencyKey:"apply-seo-json-boundary-1",command:"Apply the exact SEO JSON boundary patch.",metadata:{capability:"primary_mac.agent.maintenance",target_device:"primary-mac",operation:"apply_seo_json_boundary",authority:"local_admin",prohibited_routes:["cm-100","stale_continuation","gmail","apple_mail","mailbox.read","mailbox.write"],repo:"/Users/mac/Georgie"}};
  const connector=harness({executeCommand:async()=>assert.fail("maintenance entered prose router")});
  const result=await connector.submit("primary-seo-json-repair",input);
  const stored=await waitFor(connector,"primary-seo-json-repair",result.commandId,["recovering"]);
  assert.deepEqual(stored.result.jobs.map(job=>job.action),["developer.apply_patch"]);
  assert.equal(stored.result.route.operation,"apply_seo_json_boundary");
});


test("durable SEO autopilot schedules one leased reversible batch chain", async () => {
  const input={source:"chatgpt",objectiveId:"SIERRA-SEO-20260824-GEORGIE-001",idempotencyKey:"seo-autopilot-start-1",command:"Start durable SEO autopilot.",metadata:{capability:"sierra.seo.autopilot",target_device:"server",operation:"start",authority:"reversible_write",prohibited_routes:["arbitrary_domain","credentials.read","wordpress.publish","dns.write","email.send","lender.submit"]}};
  const envelope=validateCommandEnvelope(input);
  assert.equal(envelope.routing.capability,"sierra.seo.autopilot");
  assert.equal(envelope.routing.authority,"reversible_write");
  assert.throws(()=>validateCommandEnvelope({...input,metadata:{...input.metadata,operation:"publish"}}),/UNSUPPORTED_OPERATION/);
  assert.throws(()=>validateCommandEnvelope({...input,metadata:{...input.metadata,authority:"local_admin"}}),/CAPABILITY_AUTHORITY_MISMATCH/);
  const connectorSource=fs.readFileSync(new URL("../src/governed-connector.js",import.meta.url),"utf8");
  const workerSource=fs.readFileSync(new URL("../src/objective-worker.js",import.meta.url),"utf8");
  assert.match(connectorSource,/resumeBlocked: true/);
  assert.match(workerSource,/objective\.status === "blocked" && input\.resumeBlocked === true/);
});

test("WordPress link repair handler is exact, backed up, verified, and fail-closed", () => {
  const source=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  assert.match(source,/browser\.wordpress_link_integrity_repair/);
  assert.match(source,/WORDPRESS_LINK_REPAIR_ROLLED_BACK/);
  assert.match(source,/backupCreated: true/);
  assert.match(source,/credentialsTransferred: false/);
  assert.match(source,/sba-bank-term-loans-for-businesses/);
  assert.match(source,/mailto:submissions@sierramarketinginc\.com/);
});


test("SEO autopilot wake and status remain bound to the scheduling user namespace", () => {
  const source=fs.readFileSync(new URL("../src/governed-connector.js",import.meta.url),"utf8");
  assert.match(source,/listScheduledObjectives, runObjectiveWorkerCycle/);
  assert.match(source,/operations: new Set\(\["start", "status"\]\)/);
  assert.match(source,/runObjectiveWorkerCycle\(userId\)/);
  assert.match(source,/listScheduledObjectives\(userId/);
  assert.match(source,/scheduledObjective:result\?\.scheduledObjective/);
  assert.match(source,/objectiveStatus:result\?\.objectiveStatus/);
});


test("SEO repair opens only the allowlisted Sierra admin origin before mutation", () => {
  const source=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  assert.match(source,/AGENT_VERSION = "2\.2\.39"/);
  assert.match(source,/execFileAsync\("open", \["-a", "Google Chrome", "https:\/\/sierramarketinginc\.com\/wp-admin\/"\]/);
  assert.match(source,/WORDPRESS_REPAIR_SITE_REJECTED/);
});


test("SEO repair uses the certified AppleScript Chrome tab path", () => {
  const source=fs.readFileSync(new URL("../mac-agent/agent.js",import.meta.url),"utf8");
  const start=source.indexOf("async function repairWordpressLinkIntegrity");
  const end=source.indexOf("\nasync function waitForAppProcess",start);
  const handler=source.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(handler,/tell application "Google Chrome"/);
  assert.match(handler,/return execute browserTab javascript/);
  assert.match(handler,/WORDPRESS_ADMIN_TAB_NOT_FOUND/);
  assert.match(handler,/JSON\.stringify\(\$\{pageScript\}\)/);
  assert.match(handler,/WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED/);
  assert.doesNotMatch(handler,/const chrome=Application\('Google Chrome'\)/);
});


test("developer repository inspection receipts preserve bounded read-only evidence", () => {
  const summary=summarizeGovernedMacJob({
    id:"job-inspect",status:"completed",action:"developer.repo_inspect",deviceId:"primary-mac",
    result:{repo:"/Users/mac/Georgie",branch:"main",status:" M package-lock.json\n?? local.tmp\n",recentCommits:"abc repair",trackedFiles:["sensitive-long-list"],readOnly:true}
  });
  assert.deepEqual(summary.repositoryInspection,{repo:"/Users/mac/Georgie",branch:"main",status:" M package-lock.json\n?? local.tmp\n",recentCommits:"abc repair",readOnly:true});
  assert.equal("trackedFiles" in summary.repositoryInspection,false);
});


test("governed Mac keyboard activation is exact-scope and maps only to existing UI actions",()=>{
  const source=fs.readFileSync(new URL("../src/governed-connector.js",import.meta.url),"utf8");
  assert.match(source,/"primary_mac\.ui_keyboard"/);
  assert.match(source,/operations: new Set\(\["open_spotlight", "focus_terminal", "type_text", "press_return"\]\)/);
  assert.match(source,/route\.capability === "primary_mac\.ui_keyboard"/);
  assert.match(source,/route\.operation === "type_text" \? "ui\.type_text" : "ui\.key"/);
  assert.match(source,/key: "return", modifiers: \[\]/);
  assert.match(source,/PRIMARY_MAC_UI_TEXT_REQUIRED/);
  assert.match(source,/connector:\$\{command\.id\}:focus_terminal:\$\{item\.suffix\}/);
  assert.match(source,/route\.operation === "open_spotlight"/);
  assert.match(source,/connector:\$\{command\.id\}:open_spotlight/);
  assert.match(source,/key: "space", modifiers: \["command down"\]/);
  assert.match(source,/text: "Terminal"/);
  assert.match(source,/"wordpress\.publish"/);
});
