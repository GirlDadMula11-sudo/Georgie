import crypto from "node:crypto";
import express from "express";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { upsertOperatingNode, transitionOperatingNode } from "./operating-graph.js";
import { enqueueMacJob, listMacJobs, resumeFailedMacJob } from "./mac/queue.js";
import { getMacDeviceStatus } from "./mac/router.js";
import { listMailboxPacketManifests } from "./mailbox-evidence-bridge.js";
import { listMessagesBefore, readMessage } from "./integrations/neo-mail.js";
import { projectSierraMailboxEvidence } from "./integrations/sierra-workforce.js";
import { scheduleObjective, listScheduledObjectives, runObjectiveWorkerCycle } from "./objective-worker.js";
import { crawlWebsite, pageSpeed, getApplicationFunnel, seoIntegrationStatus, websiteControlStatus } from "./integrations/seo-ops.js";

const NS = "governed_external_connector";
const SCHEMA = "georgie.governed-connector.v1";
const locks = new Map();
const now = () => new Date().toISOString();
const clean = (value, max = 6000) => String(value || "").trim().slice(0, max);
const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
export function summarizeGovernedMacJob(job = {}) { return { id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, authority: job.args?.authority || null, checkpoint: job.args?.checkpoint || null, attempts: job.attempts, claimedAt: job.claimedAt, completedAt: job.completedAt, error: job.error, dispatchReceipt: job.dispatchReceipt, cursor: job.result?.mailboxEvidenceBatch?.cursor || {}, packetCount: job.result?.mailboxEvidenceBatch?.packets?.length || 0, quarantineCount: job.result?.quarantine?.length || job.result?.mailboxEvidenceBatch?.quarantine?.length || 0, connections: job.result?.connection || null, staticContractInspection: job.result?.neoStaticContractInspection || null, browserInspection: job.result?.governedBrowserInspection || null }; }
const CAPABILITIES = Object.freeze({
  "sierra.seo.autopilot": Object.freeze({
    targetDevice: "server",
    authorityByOperation: Object.freeze({ start: "reversible_write", status: "read_only" }),
    operations: new Set(["start", "status"]),
    prohibitedRoutes: new Set(["arbitrary_domain", "credentials.read", "wordpress.publish", "dns.write", "email.send", "lender.submit"])
  }),
  "primary_mac.browser.wordpress_read_only": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["inspect_session"]),
    prohibitedRoutes: new Set(["arbitrary_domain", "credentials.read", "form.submit", "content.write", "wordpress.publish", "dns.write", "email.send"])
  }),
  "sierra.seo.workflow": Object.freeze({
    targetDevice: "server",
    authority: "read_only",
    operations: new Set(["discovery_baseline"]),
    prohibitedRoutes: new Set(["sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation", "sierra.deal", "sierra.reprocess_documents", "email.send", "lender.submit", "dns.write", "production.deploy"])
  }),
  "developer.repository_inspection": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["inspect", "read_file"]),
    prohibitedRoutes: new Set(["email.send", "smtp", "mailbox.write", "lender.submit", "production.deploy"])
  }),
  "developer.patch_preparation": Object.freeze({
    targetDevice: "primary-mac",
    authority: "prepare_only",
    operations: new Set(["prepare_hash_bound_patch", "run_allowlisted_checks"]),
    prohibitedRoutes: new Set(["email.send", "smtp", "mailbox.write", "lender.submit", "production.deploy"])
  }),
  "developer.patch_application": Object.freeze({
    targetDevice: "primary-mac",
    authority: "approved_exact_patch",
    operations: new Set(["apply_hash_bound_patch"]),
    prohibitedRoutes: new Set(["email.send", "smtp", "mailbox.write", "lender.submit", "production.deploy"])
  }),
  "neo_mail.imap.read_only": Object.freeze({
    targetDevice: "server",
    authority: "read_only",
    operations: new Set(["connection_verify_and_backfill"]),
    prohibitedRoutes: new Set(["email.send", "smtp", "mailbox.write", "gmail", "apple_mail"])
  }),
  "sierra.mailbox_evidence.project": Object.freeze({
    targetDevice: "server",
    authorityByOperation: Object.freeze({ checkpoint_status: "read_only", project_immutable_receipts: "evidence_write" }),
    operations: new Set(["checkpoint_status", "project_immutable_receipts"]),
    prohibitedRoutes: new Set(["email.send", "smtp", "mailbox.write", "external.notification", "lender.submit"])
  }),
  "primary_mac.neo.cdp_read_only": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["verify_session"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "mailbox.write"])
  }),
  "primary_mac.mailbox.read_only": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["connection_verify_and_backfill", "static_contract_inspection"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation"])
  }),
  "neo_mailbox_evidence_bridge": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["connection_verify_and_backfill", "static_contract_inspection"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation"])
  }),
  "primary_mac.agent.maintenance": Object.freeze({
    targetDevice: "primary-mac",
    authority: "local_admin",
    operations: new Set(["update_restart_from_main", "install_neo_preload", "inspect_neo_preload", "normalize_generated_lock", "apply_neo_manifest_fix", "apply_governed_browser_agent", "apply_seo_autopilot_agent", "apply_seo_autopilot_agent_v2", "apply_seo_json_boundary"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "mailbox.read", "mailbox.write"])
  })
});

function baseState() { return { schema: SCHEMA, version: 2, commands: [], leases: [], events: [], receipts: [], updatedAt: null }; }
export function normalizeConnectorState(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { ...baseState(), ...input, schema: SCHEMA, version: 2, commands: Array.isArray(input.commands) ? input.commands : [], leases: Array.isArray(input.leases) ? input.leases : [], events: Array.isArray(input.events) ? input.events : [], receipts: Array.isArray(input.receipts) ? input.receipts : [] };
}
function commandId(userId, source, key) { return `cmd_${digest(`${userId}:${source}:${key}`).slice(0, 32)}`; }
function objectiveId(userId, source, supplied, command) { return supplied ? clean(supplied, 160) : `obj_${digest(`${userId}:${source}:${command}`).slice(0, 32)}`; }
function receiptFor(command, status, payload = {}) {
  const createdAt = now();
  const body = { commandId: command.id, objectiveId: command.objectiveId, status, createdAt, payload };
  return { ...body, receiptId: `rcpt_${digest(JSON.stringify(body)).slice(0, 32)}` };
}
async function exclusive(userId, work) {
  const key = String(userId); const prior = locks.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(work); locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}

export function validateCommandEnvelope(input = {}) {
  const source = clean(input.source || "chatgpt", 80).toLowerCase();
  const idempotencyKey = clean(input.idempotencyKey, 200);
  const command = clean(input.command);
  const kind = input.kind === "approval" ? "approval" : "command";
  if (!/^[a-z0-9._-]{2,80}$/.test(source)) throw new Error("A valid connector source is required");
  if (!idempotencyKey) throw new Error("An idempotency key is required");
  if (!command) throw new Error("A command is required");
  if (kind === "approval" && (!clean(input.planId, 160) || !clean(input.approvalId, 160))) throw new Error("Approval forwarding requires both planId and approvalId");
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const nested = metadata.command_envelope && typeof metadata.command_envelope === "object" ? metadata.command_envelope : {};
  const objectiveIdValue = clean(input.objective_id || input.objectiveId || nested.objective_id || nested.objectiveId, 160) || null;
  const capability = clean(input.capability || metadata.capability || metadata.requiredCapability || nested.capability, 160).toLowerCase();
  const targetDevice = clean(input.target_device || input.targetDevice || metadata.target_device || metadata.targetDevice || metadata.deviceId || nested.target_device || nested.targetDevice, 160);
  const operation = clean(input.operation || metadata.operation || nested.operation, 160).toLowerCase();
  const authority = clean(input.authority || metadata.authority || metadata.mode || nested.authority, 80).toLowerCase();
  const prohibitedRoutes = [...new Set((input.prohibited_routes || metadata.prohibited_routes || metadata.prohibitedRoutes || nested.prohibited_routes || nested.prohibitedRoutes || []).map((value) => clean(value, 160).toLowerCase()).filter(Boolean))];
  const typed = Boolean(capability || targetDevice || operation || authority || prohibitedRoutes.length);
  if (typed && !objectiveIdValue) throw new Error("Typed command envelope requires objective_id");
  if (typed && (!capability || !targetDevice || !operation || !authority)) throw new Error("Typed command envelope requires capability, target_device, operation, and authority");
  if (typed) {
    const contract = CAPABILITIES[capability];
    if (!contract) throw new Error(`UNSUPPORTED_CAPABILITY: ${capability}`);
    if (targetDevice !== contract.targetDevice) throw new Error(`CAPABILITY_TARGET_MISMATCH: ${capability} requires ${contract.targetDevice}`);
    if (!contract.operations.has(operation)) throw new Error(`UNSUPPORTED_OPERATION: ${capability}/${operation}`);
    const requiredAuthority = contract.authorityByOperation?.[operation] || contract.authority;
    if (authority !== requiredAuthority) throw new Error(`CAPABILITY_AUTHORITY_MISMATCH: ${capability}/${operation} requires ${requiredAuthority}`);
    for (const route of prohibitedRoutes) if (!contract.prohibitedRoutes.has(route)) throw new Error(`UNKNOWN_PROHIBITED_ROUTE: ${route}`);
  }
  return { source, idempotencyKey, command, kind, objectiveId: objectiveIdValue, planId: clean(input.planId, 160) || null, approvalId: clean(input.approvalId, 160) || null, metadata, routing: typed ? { objective_id: objectiveIdValue, capability, target_device: targetDevice, operation, authority, idempotency_key: idempotencyKey, prohibited_routes: prohibitedRoutes } : null };
}

async function executeTypedCapability({ userId, command }) {
  const route = command.routing;
  if (route.capability === "sierra.seo.autopilot") {
    if (route.operation === "status") {
      const objectives = (await listScheduledObjectives(userId, { status: "all", limit: 100 })).filter(item => item.stableKey === route.objective_id);
      const objective = objectives.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
      const repairJobs = (await listMacJobs(userId, 100)).filter(job => job.action === "browser.wordpress_link_integrity_repair").slice(-20).map(summarizeGovernedMacJob);
      return { terminalState: "completed", completed: true, route, objectiveStatus: objective ? { id: objective.id, stableKey: objective.stableKey, status: objective.status, stepIndex: objective.stepIndex, steps: objective.steps.map(step => step.id), attempts: objective.attempts, nextRunAt: objective.nextRunAt, lease: objective.lease, checkpoint: objective.checkpoint, evidence: objective.evidence.slice(-20), repairJobs } : null, productionMutation: false };
    }
    const scheduled = await scheduleObjective(userId, {
      stableKey: route.objective_id,
      title: "Sierra durable SEO repair workflow",
      domain: "seo",
      priority: "high",
      maxAttempts: 12,
      steps: [
        { id: "baseline-before-write", tool: "seo.discovery_baseline", policy: "read", args: { maxPages: 150 } },
        {
          id: "repair-link-integrity",
          tool: "seo.wordpress_link_integrity_repair",
          policy: "low_risk_write",
          args: { deviceId: "primary-mac", siteOrigin: "https://sierramarketinginc.com", authority: "reversible_write" },
          verification: { tool: "seo.wordpress_link_integrity_verify", args: { maxPages: 150 }, expect: { verified: true } },
          delayMsAfter: 1000
        },
        { id: "baseline-after-link-repair", tool: "seo.discovery_baseline", policy: "read", args: { maxPages: 150 } }
      ]
    });
    setImmediate(() => runObjectiveWorkerCycle(userId).catch(error => console.warn("[Georgie] SEO objective wake failed:", error instanceof Error ? error.message : error)));
    return { terminalState: "completed", completed: true, route, scheduledObjective: { id: scheduled.objective.id, stableKey: scheduled.objective.stableKey, status: scheduled.objective.status, stepIndex: scheduled.objective.stepIndex, steps: scheduled.objective.steps.map(step => step.id) }, productionMutation: false };
  }
  if (route.capability === "primary_mac.browser.wordpress_read_only") {
    const siteOrigin = clean(command.metadata?.site_origin || "https://sierramarketinginc.com", 300).replace(/\/$/, "");
    if (siteOrigin !== "https://sierramarketinginc.com") throw new Error("PRIMARY_MAC_BROWSER_SITE_NOT_ALLOWLISTED");
    const job = await enqueueMacJob({
      userId,
      deviceId: route.target_device,
      action: "browser.wordpress_hostinger_inspect",
      args: { objectiveId: route.objective_id, authority: route.authority, operation: route.operation, siteOrigin },
      risk: "read",
      reason: "Inspect the approved Sierra WordPress and Hostinger browser session without form values, credentials, or mutation",
      idempotencyKey: `connector:${command.id}:${route.operation}`,
      maxAttempts: 1
    });
    return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };
  }
  if (route.capability === "sierra.seo.workflow") {
    const maxPages = Math.max(1, Math.min(Number(command.metadata?.max_pages || 150), 500));
    const integration = seoIntegrationStatus();
    const websiteControl = websiteControlStatus();
    const crawl = await crawlWebsite({ startUrl: integration.websiteRoot, maxPages });
    const representativeUrls = [...new Set([
      integration.websiteRoot,
      ...crawl.pages.filter((page) => page.status === 200).map((page) => page.finalUrl || page.url)
    ])].slice(0, Math.max(1, Math.min(Number(command.metadata?.pagespeed_limit || 5), 10)));
    const performanceSettled = await Promise.allSettled(representativeUrls.flatMap((url) => [
      pageSpeed(url, { strategy: "mobile" }),
      pageSpeed(url, { strategy: "desktop" })
    ]));
    const performance = performanceSettled.map((result, index) => result.status === "fulfilled"
      ? { ok: true, ...result.value }
      : { ok: false, url: representativeUrls[Math.floor(index / 2)], strategy: index % 2 === 0 ? "mobile" : "desktop", error: clean(result.reason instanceof Error ? result.reason.message : result.reason, 500) });
    let applicationFunnel = null;
    let applicationFunnelError = null;
    try { applicationFunnel = await getApplicationFunnel({ days: Math.max(1, Math.min(Number(command.metadata?.funnel_days || 30), 365)) }); }
    catch (error) { applicationFunnelError = clean(error instanceof Error ? error.message : error, 500); }
    return {
      terminalState: "completed",
      completed: true,
      route,
      integration,
      websiteControl,
      crawl,
      performance,
      applicationFunnel,
      applicationFunnelError,
      defects: {
        broken: crawl.pages.filter((page) => Number(page.status) >= 400),
        redirectChains: crawl.pages.filter((page) => (page.redirectChain || []).length > 1),
        missingTitles: crawl.pages.filter((page) => page.status === 200 && !page.title),
        missingDescriptions: crawl.pages.filter((page) => page.status === 200 && !page.description),
        missingCanonicals: crawl.pages.filter((page) => page.status === 200 && !page.canonical),
        missingH1: crawl.pages.filter((page) => page.status === 200 && page.h1Count === 0),
        multipleH1: crawl.pages.filter((page) => page.status === 200 && page.h1Count > 1),
        missingStructuredData: crawl.pages.filter((page) => page.status === 200 && page.structuredDataBlocks === 0)
      },
      quarantinedRoutes: [...CAPABILITIES["sierra.seo.workflow"].prohibitedRoutes],
      productionMutation: false
    };
  }
  if (route.capability.startsWith("developer.")) {
    const repo = clean(command.metadata?.repo || "/Users/mac/Georgie", 300);
    if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
    const patch = String(command.metadata?.patch || "");
    const patchHash = clean(command.metadata?.patch_hash || command.metadata?.patchHash, 128);
    let action, args, risk, reason;
    if (route.capability === "developer.repository_inspection") {
      if (route.operation === "read_file") {
        const filePath = clean(command.metadata?.path, 300);
        if (filePath !== "mac-agent/agent.js") throw new Error("DEVELOPER_READ_PATH_NOT_ALLOWLISTED");
        action = "developer.file_read"; args = { repo, path: filePath }; risk = "read"; reason = "Governed allowlisted source read";
      } else {
        action = "developer.repo_inspect"; args = { repo }; risk = "read"; reason = "Governed repository inspection";
      }
    } else if (route.operation === "run_allowlisted_checks") {
      const script = clean(command.metadata?.script || "test", 40);
      if (!["check", "test", "benchmark"].includes(script)) throw new Error("DEVELOPER_CHECK_NOT_ALLOWLISTED");
      action = "developer.run_checks"; args = { repo, script }; risk = "sensitive_write"; reason = "Governed allowlisted repository verification";
    } else {
      if (!patch || !patchHash || digest(patch) !== patchHash) throw new Error("DEVELOPER_PATCH_HASH_MISMATCH");
      action = route.capability === "developer.patch_preparation" ? "developer.prepare_patch" : "developer.apply_patch";
      args = { repo, patch, patchHash, approvalId: command.approvalId, planId: command.planId };
      risk = route.capability === "developer.patch_preparation" ? "low_risk_write" : "sensitive_write";
      reason = route.capability === "developer.patch_preparation" ? "Prepare exact hash-bound patch" : "Apply exact approved hash-bound patch";
      if (route.capability === "developer.patch_application" && (!command.planId || !command.approvalId)) throw new Error("DEVELOPER_PATCH_APPROVAL_REQUIRED");
    }
    const job = await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk, reason, idempotencyKey: `connector:${command.id}:${route.operation}`, maxAttempts: 1 });
    return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, dispatchReceipt: job.dispatchReceipt } };
  }
  if (route.capability === "sierra.mailbox_evidence.project") {
    if (route.operation === "checkpoint_status") {
      const state = normalizeConnectorState(await readCloudState(String(userId), NS, baseState()));
      const commands = state.commands.filter((item) => item.objectiveId === route.objective_id);
      const receipts = state.receipts.filter((item) => item.objectiveId === route.objective_id);
      return { terminalState:"completed", completed:true, route, checkpoint:{ objectiveId:route.objective_id, commandCount:commands.length, receiptCount:receipts.length, latestCommandStatus:commands.at(-1)?.status||null, latestReceiptStatus:receipts.at(-1)?.status||null }, evidence:[], errors:[], mailboxMutation:false, markSeen:false, prohibitedTool:"email.send" };
    }
    const receiptIds = [...new Set((command.metadata?.receipt_ids || []).map(value => clean(value, 200)))];
    if (!receiptIds.length || receiptIds.length > 100) throw new Error("SIERRA_MAILBOX_PROJECTION_RECEIPTS_REQUIRED");
    const state = normalizeConnectorState(await readCloudState(String(userId), NS, baseState()));
    const receipts = receiptIds.map(receiptId => state.receipts.find(item => item.receiptId === receiptId));
    if (receipts.some(receipt => !receipt || receipt.objectiveId !== route.objective_id || receipt.status !== "completed")) throw new Error("SIERRA_MAILBOX_PROJECTION_RECEIPT_SCOPE_REJECTED");
    const evidence = receipts.flatMap(receipt => Array.isArray(receipt.payload?.resultSummary?.evidence) ? receipt.payload.resultSummary.evidence : []);
    if (!evidence.length) throw new Error("SIERRA_MAILBOX_PROJECTION_EVIDENCE_EMPTY");
    const projection = await projectSierraMailboxEvidence(userId, { objectiveId:route.objective_id, idempotencyKey:route.idempotency_key, receipts:receipts.map(item => ({ receiptId:item.receiptId, commandId:item.commandId, createdAt:item.createdAt, responseHash:item.payload?.responseHash||null })), evidence });
    return { terminalState:"completed", completed:true, route, projection, evidence:[], errors:[], mailboxMutation:false, markSeen:false, prohibitedTool:"email.send" };
  }
  if (route.capability === "neo_mail.imap.read_only") {
    const requested = [...new Set((command.metadata?.mailboxes || []).map(value => clean(value, 320).toLowerCase()))];
    if (!requested.length || requested.some(value => !/^[^@\s]+@sierramarketinginc\.com$/.test(value))) throw new Error("NEO_IMAP_MAILBOX_SCOPE_REJECTED");
    const limit = Math.min(100, Math.max(1, Number(command.metadata?.limit || 100)));
    const evidence = [];
    const errors = [];
    const cursors = {};
    const beforeUids = command.metadata?.before_uids && typeof command.metadata.before_uids === "object" ? command.metadata.before_uids : {};
    const outcomePattern = /\b(approved?|offer(?:ed)?|declin(?:e|ed)|denied|funded|funding|stip(?:ulation)?s?|conditions?|term sheet|payoff|renewal)\b/i;
    const lenderPattern = /\b(dexly|rapid finance|spartan|principis|smartstep|tvt|essentia|iou|kapitus|smartbiz|velocity|bizfund|loan23|zlur|e capital|lima one|kiavi|loanbuilder|national funding|fundbox|ondeck|fundworks|fundkite|credibly|libertas|itiria|mulligan|cfg|capflow|avana|idea financial)\b/i;
    for (const mailbox of requested) {
      let page;
      try { page = await listMessagesBefore(mailbox, { beforeUid: beforeUids[mailbox] ?? null, limit }); cursors[mailbox] = { nextBeforeUid: page.nextBeforeUid, exhausted: page.exhausted, scanned: page.messages.length }; }
      catch (error) { errors.push({ mailbox, stage: "list", error: clean(error instanceof Error ? error.message : error, 500) }); continue; }
      for (const row of page.messages) {
        if (!outcomePattern.test(`${row.subject || ""} ${row.from || ""}`) && !lenderPattern.test(`${row.subject || ""} ${row.from || ""}`)) continue;
        try {
          const message = await readMessage(mailbox, row.uid, { markSeen: false });
          const corpus = `${message.subject || ""}\n${message.from || ""}\n${message.text || ""}`;
          if (!outcomePattern.test(corpus) && !lenderPattern.test(corpus)) continue;
          const amount = corpus.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1] || null;
          const classification = /\bfunded|funding complete\b/i.test(corpus) ? "funding" : /\bdeclin(?:e|ed)|denied\b/i.test(corpus) ? "decline" : /\bapproved?|offer(?:ed)?|term sheet\b/i.test(corpus) ? "offer_or_approval" : /\bstip(?:ulation)?s?|conditions?\b/i.test(corpus) ? "stipulation" : "lender_communication";
          const bodyExcerpt = clean(String(message.text || "").replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, "[REDACTED_SSN]").replace(/\b\d{2}-?\d{7}\b/g, "[REDACTED_EIN]").replace(/\b\d{8,17}\b/g, "[REDACTED_FINANCIAL_NUMBER]"), 1200);
          const canonical = { mailbox, uid: message.uid, messageId: message.messageId || null, date: message.date || row.date || null, from: clean(message.from, 500), subject: clean(message.subject, 1000), classification, amount: amount ? Number(amount.replace(/,/g, "")) : null, bodyExcerpt };
          evidence.push({ ...canonical, canonicalHash: digest(JSON.stringify(canonical)) });
          if (evidence.length >= 50) break;
        } catch (error) { errors.push({ mailbox, uid: row.uid, stage: "read", error: clean(error instanceof Error ? error.message : error, 500) }); }
      }
      if (evidence.length >= 50) break;
    }
    return { terminalState: "completed", completed: true, route, evidence, errors, cursors, mailboxMutation: false, markSeen: false, prohibitedTool: "email.send" };
  }
  if (route.capability === "primary_mac.neo.cdp_read_only") {
    const job = await enqueueMacJob({ userId, deviceId: route.target_device, action: "mailbox.neo_cdp_verify_session", args: { objectiveId: route.objective_id, authority: route.authority, mailboxes: command.metadata?.mailboxes || [] }, risk: "read", reason: "Verify local loopback CDP and exact NEO mailbox bindings without message access", idempotencyKey: `connector:${command.id}:${route.operation}`, maxAttempts: 1 });
    return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };
  }
  if (route.capability === "primary_mac.agent.maintenance") {
    const repo = clean(command.metadata?.repo || "/Users/mac/Georgie", 300);
    if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
    const lockPatch = `diff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1,12 +1,12 @@\n {\n   "name": "georgie",\n-  "version": "2.2.22",\n+  "version": "2.2.21",\n   "lockfileVersion": 3,\n   "requires": true,\n   "packages": {\n     "": {\n       "name": "georgie",\n-      "version": "2.2.22",\n+      "version": "2.2.21",\n       "dependencies": {\n         "dotenv": "^16.4.5",\n         "express": "^4.21.1",\n`;
    const neoManifestPatch = "diff --git a/mac-agent/neo-preload-extension/manifest.json b/mac-agent/neo-preload-extension/manifest.json\n--- a/mac-agent/neo-preload-extension/manifest.json\n+++ b/mac-agent/neo-preload-extension/manifest.json\n@@ -1,7 +1,7 @@\n {\n   \"manifest_version\": 3,\n   \"name\": \"Georgie NEO Read-Only Preload\",\n-  \"version\": \"1.6.0\",\n+  \"version\": \"1.6.1\",\n   \"description\": \"Local read-only Chrome debugger relay for the governed NEO evidence bridge.\",\n   \"permissions\": [\n     \"debugger\"\n@@ -16,6 +16,16 @@\n     {\n       \"matches\": [\n         \"https://app.neo.space/*\"\n+      ],\n+      \"js\": [\n+        \"preload.js\"\n+      ],\n+      \"run_at\": \"document_start\",\n+      \"world\": \"MAIN\"\n+    },\n+    {\n+      \"matches\": [\n+        \"https://app.neo.space/*\"\n       ],\n       \"js\": [\n         \"diagnostic.js\"\n";
    const governedBrowserAgentPatch = "diff --git a/mac-agent/agent.js b/mac-agent/agent.js\n--- a/mac-agent/agent.js\n+++ b/mac-agent/agent.js\n@@ -11,7 +11,7 @@\n const execFileAsync = promisify(execFile);\n const BASE = String(process.env.GEORGIE_SERVER_URL || \"\").replace(/\\/$/, \"\");\n const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || \"primary-mac\";\n+const AGENT_VERSION = \"2.2.29\";\n-const AGENT_VERSION = \"2.2.28\";\n const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;\n const INTERVAL = Math.max(750, Number(process.env.GEORGIE_MAC_POLL_MS || 1000));\n const MAX_BACKOFF = Math.max(INTERVAL, Number(process.env.GEORGIE_MAC_MAX_BACKOFF_MS || 30000));\n@@ -110,6 +110,42 @@\n   return { ...parsed, approvedDomains: domains, credentialRedactionApplied: true, formValuesCaptured: false };\n }\n \n+const GOVERNED_WORDPRESS_BROWSER_HOSTS = Object.freeze([\"sierramarketinginc.com\", \"hostinger.com\"]);\n+function governedWordpressHost(rawUrl) {\n+  try {\n+    const host = new URL(String(rawUrl || \"\")).hostname.toLowerCase();\n+    return GOVERNED_WORDPRESS_BROWSER_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`)) ? host : null;\n+  } catch { return null; }\n+}\n+async function inspectGovernedWordpressSession(args = {}) {\n+  if (args.authority !== \"read_only\" || args.operation !== \"inspect_session\") throw new Error(\"GOVERNED_BROWSER_AUTHORIZATION_REJECTED\");\n+  if (String(args.siteOrigin || \"\").replace(/\\/$/, \"\") !== \"https://sierramarketinginc.com\") throw new Error(\"GOVERNED_BROWSER_SITE_REJECTED\");\n+  const observed = await inspectBrowserTabs({ includeContent: true });\n+  const tabs = (observed.tabs || []).filter(tab => governedWordpressHost(tab.url)).map(tab => ({\n+    browser: tab.browser, window: tab.window, tab: tab.tab, active: tab.active,\n+    title: tab.title, url: tab.url, contentApproved: tab.contentApproved,\n+    content: tab.content, contentError: tab.contentError\n+  }));\n+  if (!tabs.length) throw new Error(\"GOVERNED_BROWSER_APPROVED_TAB_NOT_FOUND\");\n+  return {\n+    governedBrowserInspection: {\n+      observedAt: observed.observedAt,\n+      approvedHosts: [...GOVERNED_WORDPRESS_BROWSER_HOSTS],\n+      tabs,\n+      tabCount: tabs.length,\n+      contentInspectedCount: tabs.filter(tab => tab.content !== null).length,\n+      browserErrors: observed.browserErrors || []\n+    },\n+    authority: \"read_only\",\n+    siteOrigin: \"https://sierramarketinginc.com\",\n+    credentialRedactionApplied: true,\n+    formValuesCaptured: false,\n+    credentialsTransferred: false,\n+    mutationPerformed: false,\n+    prohibitedActions: [\"form.submit\", \"content.write\", \"wordpress.publish\", \"dns.write\", \"email.send\"]\n+  };\n+}\n+\n async function waitForAppProcess(app, timeoutMs = 8000) {\n   const deadline = Date.now() + timeoutMs;\n   while (Date.now() < deadline) {\n@@ -419,6 +455,8 @@\n     }\n     case \"browser.inspect_tabs\":\n       return inspectBrowserTabs({ includeContent: a.includeContent !== false });\n+    case \"browser.wordpress_hostinger_inspect\":\n+      return inspectGovernedWordpressSession(a);\n     case \"browser.workflow\":\n       return executeBrowserWorkflow(job);\n     case \"mailbox.neo_static_contract_inspect\":\n";
    const seoAutopilotAgentPatch = "diff --git a/mac-agent/agent.js b/mac-agent/agent.js\n--- a/mac-agent/agent.js\n+++ b/mac-agent/agent.js\n@@ -11,7 +11,7 @@\n const execFileAsync = promisify(execFile);\n const BASE = String(process.env.GEORGIE_SERVER_URL || \"\").replace(/\\/$/, \"\");\n const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || \"primary-mac\";\n+const AGENT_VERSION = \"2.2.30\";\n-const AGENT_VERSION = \"2.2.29\";\n const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;\n const INTERVAL = Math.max(750, Number(process.env.GEORGIE_MAC_POLL_MS || 1000));\n const MAX_BACKOFF = Math.max(INTERVAL, Number(process.env.GEORGIE_MAC_MAX_BACKOFF_MS || 30000));\n@@ -146,6 +146,57 @@\n   };\n }\n \n+async function repairWordpressLinkIntegrity(args = {}) {\n+  if (args.authority !== \"reversible_write\" || args.operation !== \"repair_link_integrity\") throw new Error(\"WORDPRESS_REPAIR_AUTHORIZATION_REJECTED\");\n+  if (String(args.siteOrigin || \"\").replace(/\\/$/, \"\") !== \"https://sierramarketinginc.com\") throw new Error(\"WORDPRESS_REPAIR_SITE_REJECTED\");\n+  const pageScript = `(() => {\n+    const nonce = window.wpApiSettings && window.wpApiSettings.nonce;\n+    if (!nonce) throw new Error('WORDPRESS_REST_NONCE_NOT_AVAILABLE');\n+    function request(method, path, body) {\n+      const xhr = new XMLHttpRequest();\n+      xhr.open(method, path, false);\n+      xhr.setRequestHeader('X-WP-Nonce', nonce);\n+      if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');\n+      xhr.send(body === undefined ? null : JSON.stringify(body));\n+      if (xhr.status < 200 || xhr.status >= 300) throw new Error('WORDPRESS_REST_' + xhr.status + ':' + path);\n+      return JSON.parse(xhr.responseText || 'null');\n+    }\n+    const collections = ['pages','posts'], originals = [], changed = [];\n+    const repair = raw => String(raw || '')\n+      .replace(/https:\\\\/\\\\/sierramarketinginc\\\\.com\\\\/sba-bank-term-loans-for-businesses\\\\//gi, 'https://sierramarketinginc.com/sba-bank-term-loans-for-business/')\n+      .replace(/([\"'])\\\\/sba-bank-term-loans-for-businesses\\\\//gi, '$1/sba-bank-term-loans-for-business/')\n+      .replace(/http:\\\\/\\\\/submissions@sierramarketinginc\\\\.com\\\\/?/gi, 'mailto:submissions@sierramarketinginc.com');\n+    try {\n+      for (const type of collections) {\n+        const rows = request('GET', '/wp-json/wp/v2/' + type + '?context=edit&per_page=100&_fields=id,slug,modified_gmt,content', undefined);\n+        for (const row of rows) {\n+          const raw = String(row.content && row.content.raw || ''), next = repair(raw);\n+          if (next === raw) continue;\n+          originals.push({type,id:row.id,slug:row.slug,modified_gmt:row.modified_gmt,content:raw});\n+          request('POST', '/wp-json/wp/v2/' + type + '/' + row.id, {content:next});\n+          changed.push({type,id:row.id,slug:row.slug,beforeLength:raw.length,afterLength:next.length});\n+        }\n+      }\n+      for (const item of originals) {\n+        const current = request('GET', '/wp-json/wp/v2/' + item.type + '/' + item.id + '?context=edit&_fields=id,content', undefined);\n+        const raw = String(current.content && current.content.raw || '');\n+        if (/sba-bank-term-loans-for-businesses\\\\/|http:\\\\/\\\\/submissions@sierramarketinginc\\\\.com/i.test(raw)) throw new Error('WORDPRESS_LINK_REPAIR_VERIFICATION_FAILED:' + item.type + ':' + item.id);\n+      }\n+      return {ok:true,changed,changedCount:changed.length,backupCount:originals.length,verified:true,rollbackPerformed:false};\n+    } catch (error) {\n+      const rollbackErrors = [];\n+      for (const item of originals.reverse()) {\n+        try { request('POST', '/wp-json/wp/v2/' + item.type + '/' + item.id, {content:item.content}); }\n+        catch (rollbackError) { rollbackErrors.push(item.type + ':' + item.id + ':' + String(rollbackError.message || rollbackError)); }\n+      }\n+      throw new Error('WORDPRESS_LINK_REPAIR_ROLLED_BACK:' + String(error.message || error) + (rollbackErrors.length ? ':ROLLBACK_ERRORS:' + rollbackErrors.join(',') : ''));\n+    }\n+  })()`;\n+  const script = `const prefix=\"https://sierramarketinginc.com/wp-admin/\";const js=${JSON.stringify(pageScript)};let out=null;const chrome=Application('Google Chrome');if(chrome.running())for(const win of chrome.windows())for(const tab of win.tabs()){if(String(tab.url()).startsWith(prefix)){out=tab.execute({javascript:js});break;}if(out!==null)break;}if(out===null)throw new Error('No approved Sierra WordPress admin tab');JSON.stringify(out);`;\n+  const result = JSON.parse(await runJxa(script) || \"{}\");\n+  return { wordpressLinkIntegrityRepair: result, siteOrigin: \"https://sierramarketinginc.com\", authority: \"reversible_write\", credentialsTransferred: false, formValuesCaptured: false, backupCreated: true, mutationPerformed: result.changedCount > 0, verified: result.verified === true, rollbackPerformed: result.rollbackPerformed === true };\n+}\n+\n async function waitForAppProcess(app, timeoutMs = 8000) {\n   const deadline = Date.now() + timeoutMs;\n   while (Date.now() < deadline) {\n@@ -457,6 +508,8 @@\n       return inspectBrowserTabs({ includeContent: a.includeContent !== false });\n     case \"browser.wordpress_hostinger_inspect\":\n       return inspectGovernedWordpressSession(a);\n+    case \"browser.wordpress_link_integrity_repair\":\n+      return repairWordpressLinkIntegrity(a);\n     case \"browser.workflow\":\n       return executeBrowserWorkflow(job);\n     case \"mailbox.neo_static_contract_inspect\":\n";
    const seoAutopilotAgentV2Patch = "diff --git a/mac-agent/agent.js b/mac-agent/agent.js\n--- a/mac-agent/agent.js\n+++ b/mac-agent/agent.js\n@@ -11,7 +11,7 @@\n const execFileAsync = promisify(execFile);\n const BASE = String(process.env.GEORGIE_SERVER_URL || \"\").replace(/\\/$/, \"\");\n const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || \"primary-mac\";\n-const AGENT_VERSION = \"2.2.30\";\n+const AGENT_VERSION = \"2.2.31\";\n const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;\n const INTERVAL = Math.max(750, Number(process.env.GEORGIE_MAC_POLL_MS || 1000));\n const MAX_BACKOFF = Math.max(INTERVAL, Number(process.env.GEORGIE_MAC_MAX_BACKOFF_MS || 30000));\n@@ -203,5 +203,7 @@\n   })()`;\n   const script = `const prefix=\"https://sierramarketinginc.com/wp-admin/\";const js=${JSON.stringify(pageScript)};let out=null;const chrome=Application('Google Chrome');if(chrome.running())for(const win of chrome.windows())for(const tab of win.tabs()){if(String(tab.url()).startsWith(prefix)){out=tab.execute({javascript:js});break;}if(out!==null)break;}if(out===null)throw new Error('No approved Sierra WordPress admin tab');JSON.stringify(out);`;\n+  await execFileAsync(\"open\", [\"-a\", \"Google Chrome\", \"https://sierramarketinginc.com/wp-admin/\"], { timeout: 15000 });\n+  await new Promise(resolve => setTimeout(resolve, 3000));\n   const result = JSON.parse(await runJxa(script) || \"{}\");\n   return { wordpressLinkIntegrityRepair: result, siteOrigin: \"https://sierramarketinginc.com\", authority: \"reversible_write\", credentialsTransferred: false, formValuesCaptured: false, backupCreated: true, mutationPerformed: result.changedCount > 0, verified: result.verified === true, rollbackPerformed: result.rollbackPerformed === true };\n }\n";
    const seoAutopilotAgentV3Patch = "diff --git a/mac-agent/agent.js b/mac-agent/agent.js\n--- a/mac-agent/agent.js\n+++ b/mac-agent/agent.js\n@@ -203,6 +203,8 @@\n-  const script = `const prefix=\"https://sierramarketinginc.com/wp-admin/\";const js=${JSON.stringify(pageScript)};let out=null;const chrome=Application('Google Chrome');if(chrome.running())for(const win of chrome.windows())for(const tab of win.tabs()){if(String(tab.url()).startsWith(prefix)){out=tab.execute({javascript:js});break;}if(out!==null)break;}if(out===null)throw new Error('No approved Sierra WordPress admin tab');JSON.stringify(out);`;\n+  const script = `tell application \"Google Chrome\"\\nrepeat with browserWindow in windows\\nrepeat with browserTab in tabs of browserWindow\\nset tabUrl to URL of browserTab\\nif tabUrl starts with \"https://sierramarketinginc.com/wp-admin/\" then\\nreturn execute browserTab javascript ${JSON.stringify(pageScript)}\\nend if\\nend repeat\\nend repeat\\nreturn \"WORDPRESS_ADMIN_TAB_NOT_FOUND\"\\nend tell`;\n   await execFileAsync(\"open\", [\"-a\", \"Google Chrome\", \"https://sierramarketinginc.com/wp-admin/\"], { timeout: 15000 });\n   await new Promise(resolve => setTimeout(resolve, 3000));\n-  const result = JSON.parse(await runJxa(script) || \"{}\");\n+  const rawResult = await runAppleScript(script);\n+  if (rawResult === \"WORDPRESS_ADMIN_TAB_NOT_FOUND\") throw new Error(\"No approved Sierra WordPress admin tab\");\n+  const result = JSON.parse(rawResult || \"{}\");\n   return { wordpressLinkIntegrityRepair: result, siteOrigin: \"https://sierramarketinginc.com\", authority: \"reversible_write\", credentialsTransferred: false, formValuesCaptured: false, backupCreated: true, mutationPerformed: result.changedCount > 0, verified: result.verified === true, rollbackPerformed: result.rollbackPerformed === true };\n }\n";
    const seoJsonBoundaryPatch = "diff --git a/mac-agent/agent.js b/mac-agent/agent.js\n--- a/mac-agent/agent.js\n+++ b/mac-agent/agent.js\n@@ -564,4 +564,22 @@ async function cycle() {\n   }\n }\n \n+const baseRunAppleScriptForWordpress = runAppleScript;\n+runAppleScript = async function runAppleScriptWithWordpressSerialization(script) {\n+  const source = String(script || \"\");\n+  const marker = /return execute browserTab javascript ([^\\n]+)\\nend if/;\n+  const match = source.match(marker);\n+  if (!match) return baseRunAppleScriptForWordpress(source);\n+  let pageScript;\n+  try {\n+    pageScript = JSON.parse(match[1]);\n+  } catch {\n+    return baseRunAppleScriptForWordpress(source);\n+  }\n+  const serializedSource = source.replace(marker, `return execute browserTab javascript ${JSON.stringify(`JSON.stringify(${pageScript})`)}\\nend if`);\n+  const result = await baseRunAppleScriptForWordpress(serializedSource);\n+  if (!result || result === \"missing value\") throw new Error(\"WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED\");\n+  return result;\n+};\n+\n console.log(`Georgie Mac Agent online as ${DEVICE_ID}`);\n";
    const specs = route.operation === "apply_seo_json_boundary"
      ? [["developer.apply_patch", { repo, patch: seoJsonBoundaryPatch, patchHash: digest(seoJsonBoundaryPatch) }, "Repair the exact WordPress AppleScript JSON result boundary without touching other local changes"]]
      : route.operation === "apply_seo_autopilot_agent_v2"
      ? [["developer.apply_patch", { repo, patch: seoAutopilotAgentV2Patch, patchHash: digest(seoAutopilotAgentV2Patch) }, "Open one controlled Sierra WordPress admin tab and install SEO agent 2.2.31"]]
      : route.operation === "apply_seo_autopilot_agent"
      ? [["developer.apply_patch", { repo, patch: seoAutopilotAgentV3Patch, patchHash: digest(seoAutopilotAgentV3Patch) }, "Upgrade the exact durable SEO WordPress handler to the proven AppleScript admin-tab path without touching other local changes"]]
      : route.operation === "apply_governed_browser_agent"
      ? [["developer.apply_patch", { repo, patch: governedBrowserAgentPatch, patchHash: digest(governedBrowserAgentPatch) }, "Apply the exact governed browser handler patch without touching other local changes"]]
      : route.operation === "apply_neo_manifest_fix"
      ? [["developer.apply_patch", { repo, patch: neoManifestPatch, patchHash: digest(neoManifestPatch) }, "Apply the exact scoped NEO document-start manifest repair"]]
      : route.operation === "install_neo_preload"
      ? [["developer.install_neo_preload", { repo }, "Install the controlled NEO document-start preload and relaunch Chrome"]]
      : route.operation === "inspect_neo_preload"
        ? [["developer.inspect_neo_preload", { repo }, "Inspect the controlled NEO preload without accessing mailbox content"]]
      : route.operation === "normalize_generated_lock"
        ? [["developer.apply_patch", { repo, patch: lockPatch, patchHash: digest(lockPatch) }, "Normalize the exact installer-generated package-lock version drift"]]
        : [["developer.update_restart_from_main", { repo }, "Fast-forward the allowlisted Georgie checkout and restart the Mac agent"]];
    const jobs = [];
    for (let index = 0; index < specs.length; index += 1) {
      const [action, args, reason] = specs[index];
      jobs.push(await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk: "sensitive_write", reason, idempotencyKey: `connector:${command.id}:${route.operation}:developer-bootstrap:${index}`, maxAttempts: 1 }));
    }
    return { terminalState: "in_progress", completed: false, route, jobs: jobs.map((job) => ({ id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, dispatchReceipt: job.dispatchReceipt })), expectedAgentVersion: clean(command.metadata?.expected_agent_version, 50) || null };
  }
  if (!["primary_mac.mailbox.read_only", "neo_mailbox_evidence_bridge"].includes(route.capability)) throw new Error(`UNSUPPORTED_CAPABILITY: ${route.capability}`);
  if (route.operation === "static_contract_inspection") {
    const job = await enqueueMacJob({ userId, deviceId: route.target_device, action: "mailbox.neo_static_contract_inspect", args: { objectiveId: route.objective_id, operation: route.operation, authority: route.authority }, risk: "read", reason: "Fail-closed static inspection of NEO bundle contracts", idempotencyKey: `connector:${command.id}:${route.operation}`, maxAttempts: 1 });
    return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, claimedByDeviceId: job.dispatchReceipt?.deviceId || null, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };
  }
  const existingJobId = clean(command.metadata?.existing_job_id || command.metadata?.existingJobId, 200);
  let job;
  if (existingJobId) {
    job = (await listMacJobs(userId, 500)).find((item) => item.id === existingJobId);
    if (!job) throw new Error(`MAC_JOB_NOT_FOUND: ${existingJobId}`);
    if (job.deviceId !== route.target_device || job.action !== "mailbox.read_only_backfill" || job.risk !== "read" || job.args?.authority !== "read_only") throw new Error("MAC_JOB_RESUME_SCOPE_REJECTED");
    if (String(job.args?.objectiveId || "") !== route.objective_id) throw new Error("MAC_JOB_OBJECTIVE_MISMATCH");
    if (["failed", "dead_letter", "completed"].includes(job.status)) job = await resumeFailedMacJob(route.target_device, existingJobId, { objectiveId: route.objective_id, expectedAction: "mailbox.read_only_backfill", verifiedAgentVersion: clean(command.metadata?.verified_agent_version, 50) || null });
  } else {
    job = await enqueueMacJob({
      userId,
      deviceId: route.target_device,
      action: "mailbox.read_only_backfill",
      args: { objectiveId: route.objective_id, operation: route.operation, authority: route.authority, checkpoint: command.metadata?.checkpoint || "connection_verification", mailboxes: command.metadata?.mailboxes || [], batchLimit: Math.min(25, Math.max(1, Number(command.metadata?.batchLimit || 25))) },
      risk: "read",
      reason: "Typed governed mailbox backfill",
      idempotencyKey: `connector:${command.id}:${route.operation}`
    });
  }
  return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, claimedByDeviceId: job.dispatchReceipt?.deviceId || null, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };
}

export function createGovernedConnector({ executeCommand, emitStatus = async () => {}, readState, writeState, retainObjective, transitionObjective, leaseTtlMs = 30_000, ownerId = null } = {}) {
  if (typeof executeCommand !== "function") throw new Error("Connector requires an executeCommand function");
  const readStore = readState || ((userId) => readCloudState(String(userId), NS, baseState()));
  const writeStore = writeState || ((userId, state) => writeCloudState(String(userId), NS, state));
  const retain = retainObjective || ((userId, input) => upsertOperatingNode(userId, input));
  const transition = transitionObjective || ((userId, id, input) => transitionOperatingNode(userId, id, input));
  const workerId = clean(ownerId || `connector-worker:${process.pid}:${crypto.randomUUID()}`, 180);
  const boundedLeaseTtlMs = Math.max(1_000, Math.min(300_000, Number(leaseTtlMs) || 30_000));
  async function read(userId) { return structuredClone(normalizeConnectorState(await readStore(userId))); }
  async function persist(userId, state) { state.updatedAt = now(); await writeStore(userId, state); return state; }
  function leaseFor(state, commandIdValue) { return state.leases.find((row) => row.commandId === commandIdValue) || null; }
  function leasePublic(lease) { return lease ? structuredClone(lease) : null; }
  async function readLease(userId, commandIdValue) { const state=await read(userId); return leasePublic(leaseFor(state,commandIdValue)); }
  function activeLease(lease, at = Date.now()) { return lease && ["queued", "running"].includes(lease.status) && Date.parse(lease.expiresAt || 0) > at; }
  function terminalLease(lease) { return lease && ["completed", "blocked", "failed", "cancelled"].includes(lease.status); }
  function newLease(command) { const createdAt=now(); return { id:`lease_${digest(`${command.id}:${command.objectiveId}`).slice(0,32)}`, commandId:command.id, objectiveId:command.objectiveId, status:"queued", owner:null, generation:0, claimedAt:null, heartbeatAt:null, expiresAt:new Date(Date.now()+boundedLeaseTtlMs).toISOString(), attempts:0, terminalReceiptId:null, createdAt, updatedAt:createdAt }; }
  async function acquireOrReturnLease(userId, command, { reclaim = true } = {}) { return exclusive(userId, async()=>{ const state=await read(userId); let lease=leaseFor(state,command.id); if(!lease){lease=newLease(command);state.leases.push(lease);await persist(userId,state);return{acquired:false,created:true,lease:leasePublic(lease)}} if(terminalLease(lease))return{acquired:false,terminal:true,lease:leasePublic(lease)}; const at=Date.now(); if(lease.status==="queued"||(!activeLease(lease,at)&&reclaim)){lease.owner=workerId;lease.generation=Number(lease.generation||0)+1;lease.status="running";lease.claimedAt=now();lease.heartbeatAt=lease.claimedAt;lease.expiresAt=new Date(at+boundedLeaseTtlMs).toISOString();lease.attempts=Number(lease.attempts||0)+1;lease.updatedAt=lease.claimedAt;await persist(userId,state);return{acquired:true,reclaimed:lease.generation>1,lease:leasePublic(lease)}} return{acquired:false,active:true,lease:leasePublic(lease)}; }); }
  async function heartbeatLease(userId, claim) { return exclusive(userId,async()=>{ const state=await read(userId),lease=leaseFor(state,claim?.commandId); if(!lease||lease.id!==claim?.id||lease.owner!==workerId||Number(lease.generation)!==Number(claim?.generation)||terminalLease(lease))return{ok:false,fenced:true,lease:leasePublic(lease)}; lease.heartbeatAt=now();lease.expiresAt=new Date(Date.now()+boundedLeaseTtlMs).toISOString();lease.updatedAt=lease.heartbeatAt;await persist(userId,state);return{ok:true,lease:leasePublic(lease)}; }); }
  async function record(userId, command, status, payload = {}, claim = null) { return exclusive(userId,async()=>{ const state=await read(userId),item=state.commands.find(row=>row.id===command.id),lease=leaseFor(state,command.id); if(claim&&(!lease||lease.id!==claim.id||lease.owner!==workerId||Number(lease.generation)!==Number(claim.generation)))throw new Error("LEASE_FENCED: execution ownership changed before terminalization"); if(item){item.status=status;item.updatedAt=now();if(["completed","blocked"].includes(status))item.completedAt=item.updatedAt;if(["failed","recovering","blocked"].includes(status))item.error=clean(payload.error,1000);if(payload.resultSummary)item.result=payload.resultSummary;} const event={id:crypto.randomUUID(),commandId:command.id,objectiveId:command.objectiveId,status,createdAt:now()},receipt=receiptFor(command,status,payload); if(lease&&claim){lease.status=status==="completed"?"completed":status==="blocked"?"blocked":status==="failed"?"failed":status==="recovering"?"queued":status;lease.terminalReceiptId=["completed","blocked","failed"].includes(status)?receipt.receiptId:lease.terminalReceiptId;lease.updatedAt=event.createdAt;if(lease.status==="queued"){lease.owner=null;lease.expiresAt=new Date(Date.now()+boundedLeaseTtlMs).toISOString();}} state.events.push(event);state.receipts.push(receipt);await persist(userId,state);await emitStatus({...event,receipt}).catch(()=>{});return receipt; }); }
  async function run(userId, command) { const claimResult=await acquireOrReturnLease(userId,command); if(claimResult.terminal||!claimResult.acquired)return{commandId:command.id,objectiveId:command.objectiveId,status:claimResult.lease?.status||command.status,lease:claimResult.lease,duplicateExecutionPrevented:true}; const claim=claimResult.lease; await record(userId,command,"running",{},claim); await transition(userId,command.operatingNodeId,{status:"active",attempted:true,nextAction:"Execute, verify, and return durable evidence."}).catch(()=>{}); const heartbeat=setInterval(()=>heartbeatLease(userId,claim).catch(()=>{}),Math.max(500,Math.floor(boundedLeaseTtlMs/3)));heartbeat.unref?.(); try{ const result=command.routing?await executeTypedCapability({userId,command}):await executeCommand({userId,sessionId:`connector:${command.source}:objective:${command.objectiveId}`,input:command.command,connector:{commandId:command.id,objectiveId:command.objectiveId,planId:command.planId,approvalId:command.approvalId,leaseId:claim.id,leaseGeneration:claim.generation}}); const resultSummary=command.routing?{terminalState:result?.terminalState||null,completed:result?.completed===true,route:result?.route||null,job:result?.job||null,jobs:result?.jobs||null,evidence:Array.isArray(result?.evidence)?result.evidence.slice(0,50):[],errors:Array.isArray(result?.errors)?result.errors.slice(0,50):[],cursors:result?.cursors||{},mailboxMutation:result?.mailboxMutation===true,markSeen:result?.markSeen===true,prohibitedTool:result?.prohibitedTool||null,expectedAgentVersion:result?.expectedAgentVersion||null,projection:result?.projection||null,integration:result?.integration||null,websiteControl:result?.websiteControl||null,crawl:result?.crawl?{...result.crawl,pages:Array.isArray(result.crawl.pages)?result.crawl.pages.slice(0,150):[]}:null,performance:Array.isArray(result?.performance)?result.performance.slice(0,20):[],applicationFunnel:result?.applicationFunnel||null,applicationFunnelError:result?.applicationFunnelError||null,defects:result?.defects||null,productionMutation:result?.productionMutation===true,scheduledObjective:result?.scheduledObjective||null,objectiveStatus:result?.objectiveStatus||null}:{text:clean(result?.text||result?.response||"",50000),actions:Array.isArray(result?.actions)?result.actions.slice(0,100):[]}; const terminalState=clean(result?.outcome?.terminalState||result?.terminalState||(result?.completed===false?"recovering":"completed"),80),evidence={responseHash:digest(JSON.stringify(result||{})),terminalState,...(resultSummary?{resultSummary}:{})}; if(result?.completed===false||["in_progress","working","recovering","queued","running"].includes(terminalState)){const receipt=await record(userId,command,"recovering",{...evidence,error:clean(result?.error||result?.exactBlocker||terminalState,1000)},claim);await transition(userId,command.operatingNodeId,{status:"recovering",recovery:"Resume this same command and lease checkpoint; do not create a duplicate.",nextAction:"Continue from the durable lease checkpoint."}).catch(()=>{});return{commandId:command.id,objectiveId:command.objectiveId,status:"recovering",result,receipt,lease:await readLease(userId,command.id)};} const blocked=terminalState==="blocked"||result?.outcome?.terminalState==="blocked"; const receipt=await record(userId,command,blocked?"blocked":"completed",evidence,claim);await transition(userId,command.operatingNodeId,blocked?{status:"blocked",nextAction:clean(result?.exactBlocker||result?.error||"Resolve the verified blocker and resume the same objective.",1000)}:{status:"verified",verification:`Connector completion receipt ${receipt.receiptId}`}).catch(()=>{});return{commandId:command.id,objectiveId:command.objectiveId,status:blocked?"blocked":"completed",result,receipt,lease:await readLease(userId,command.id)}; }catch(error){const message=error instanceof Error?error.message:String(error);if(/^LEASE_FENCED:/.test(message))return{commandId:command.id,objectiveId:command.objectiveId,status:(await readLease(userId,command.id))?.status||"running",error:message,lease:await readLease(userId,command.id),duplicateExecutionPrevented:true};const receipt=await record(userId,command,"recovering",{error:message},claim);await transition(userId,command.operatingNodeId,{status:"recovering",recovery:"Resume this same command ID after the temporary blocker is resolved; do not create a duplicate.",nextAction:message}).catch(()=>{});return{commandId:command.id,objectiveId:command.objectiveId,status:"recovering",error:message,receipt,lease:await readLease(userId,command.id)};}finally{clearInterval(heartbeat);} }
  const scheduledRuns = new Set();
  function schedule(userId,command){
    const key=`${String(userId)}:${command.id}`;
    if(scheduledRuns.has(key))return false;
    scheduledRuns.add(key);
    setImmediate(()=>run(userId,command)
      .catch(error=>console.error(`[Georgie] connector background execution failed ${command.id}:`,error instanceof Error?error.stack||error.message:error))
      .finally(()=>scheduledRuns.delete(key)));
    return true;
  }
  async function submit(userId="primary",input={}){const envelope=validateCommandEnvelope(input);let command,duplicate=false,acceptedReceipt,lease;await exclusive(userId,async()=>{const state=await read(userId),id=commandId(userId,envelope.source,envelope.idempotencyKey),existing=state.commands.find(row=>row.id===id);if(existing){command=existing;duplicate=true;lease=leaseFor(state,id);return;}const objective=objectiveId(userId,envelope.source,envelope.objectiveId,envelope.command),node=await retain(userId,{stableKey:`connector:${objective}`,kind:envelope.kind==="approval"?"execution":"objective",title:envelope.command.slice(0,240),domain:"general",status:"planned",nextAction:"Dispatch through the governed connector and preserve completion evidence.",approvalId:envelope.approvalId});command={id,objectiveId:objective,operatingNodeId:node.id,...envelope,status:"accepted",attempts:0,createdAt:now(),updatedAt:now()};lease=newLease(command);state.commands.push(command);state.leases.push(lease);const event={id:crypto.randomUUID(),commandId:id,objectiveId:objective,status:"accepted",createdAt:now()};acceptedReceipt=receiptFor(command,"accepted",{leaseId:lease.id});state.events.push(event);state.receipts.push(acceptedReceipt);await persist(userId,state);await emitStatus({...event,receipt:acceptedReceipt}).catch(()=>{});});if(duplicate){if(["accepted","running","recovering","failed"].includes(command.status)&&(!activeLease(lease)||lease?.status==="queued"))schedule(userId,command);return{commandId:command.id,objectiveId:command.objectiveId,status:command.status,duplicate:true,lease:leasePublic(lease),result:command.result||null};}schedule(userId,command);return{commandId:command.id,objectiveId:command.objectiveId,status:"accepted",lease:leasePublic(lease),receipt:acceptedReceipt};}
  async function status(userId="primary",id){const state=await read(userId),command=state.commands.find(row=>row.id===id);if(!command)return null;const response={...command,lease:leasePublic(leaseFor(state,id)),events:state.events.filter(row=>row.commandId===id),receipts:state.receipts.filter(row=>row.commandId===id)};if(command.routing?.capability==="primary_mac.agent.maintenance"){const ids=new Set((command.result?.jobs||[]).map(job=>job.id));response.macJobs=(await listMacJobs(userId,500)).filter(job=>ids.has(job.id)).map(job=>({id:job.id,status:job.status,action:job.action,deviceId:job.deviceId,attempts:job.attempts,claimedAt:job.claimedAt,completedAt:job.completedAt,error:job.error,dispatchReceipt:job.dispatchReceipt}));response.macDevices=getMacDeviceStatus();}const jobId=clean(command.result?.job?.id||command.metadata?.existing_job_id||command.metadata?.existingJobId,200);if(jobId&&command.objectiveId){const job=(await listMacJobs(userId,500)).find(item=>item.id===jobId&&String(item.args?.objectiveId||"")===command.objectiveId);if(job)response.macJob=summarizeGovernedMacJob(job);response.packetManifests=await listMailboxPacketManifests(userId,{objectiveId:command.objectiveId,limit:25});}return response;}
  async function resume(userId="primary"){const state=await read(userId),pending=state.commands.filter(row=>["accepted","running","recovering","failed"].includes(row.status)),scheduled=[];for(const command of pending){const lease=leaseFor(state,command.id);if(!activeLease(lease)||lease?.status==="queued"){schedule(userId,command);scheduled.push({commandId:command.id,objectiveId:command.objectiveId});}}return scheduled;}
  return{submit,status,resume,run,acquireOrReturnLease,heartbeatLease};
}

function authorized(req) {
  const expected = clean(process.env.GEORGIE_CONNECTOR_TOKEN, 500); const supplied = clean(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), 500);
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function createGovernedConnectorRouter({ executeCommand, emitStatus } = {}) {
  const router = express.Router(); const connector = createGovernedConnector({ executeCommand, emitStatus });
  router.use((req, res, next) => authorized(req) ? next() : res.status(401).json({ ok: false, error: "Governed connector authentication required" }));
  router.post("/commands", async (req, res) => { try { const result = await connector.submit(req.body?.userId || "primary", req.body || {}); res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Connector command rejected" }); } });
  router.post("/approvals", async (req, res) => { try { const body = { ...(req.body || {}), kind: "approval", command: req.body?.command || `Approve plan ${req.body?.planId} under approval ${req.body?.approvalId}` }; const result = await connector.submit(body.userId || "primary", body); res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Approval forwarding rejected" }); } });
  router.get("/commands/:id", async (req, res) => { const result = await connector.status(req.query?.userId || "primary", req.params.id); res.status(result ? 200 : 404).json(result ? { ok: true, command: result } : { ok: false, error: "Command not found" }); });
  return router;
}
