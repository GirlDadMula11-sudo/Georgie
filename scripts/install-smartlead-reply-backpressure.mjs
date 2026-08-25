import fs from "node:fs";

const path = "src/smartlead-reply-closer-worker.js";
let source = fs.readFileSync(path, "utf8");
let changed = false;
const successorInstalled = /const WORKER_VERSION = "georgie\.smartlead-reply-closer\.v2\.5\.\d+";/.test(source)
  && source.includes("nextReplyCloserSchedule")
  && source.includes("adaptiveBackpressure: true");

function replaceRequired(from, to, label) {
  if (successorInstalled) return;
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Smartlead reply backpressure installer missing ${label} anchor`);
  source = source.replace(from, to);
  changed = true;
}

replaceRequired(
  'import { evaluateSmartleadWebhookThreadFallback } from "./smartlead-reply-fallback-evidence.js";',
  'import { evaluateSmartleadWebhookThreadFallback } from "./smartlead-reply-fallback-evidence.js";\nimport { nextReplyCloserSchedule } from "./smartlead-reply-backpressure.js";',
  "backpressure import"
);

replaceRequired(
  'const WORKER_VERSION = "georgie.smartlead-reply-closer.v2.4";',
  'const WORKER_VERSION = "georgie.smartlead-reply-closer.v2.5";',
  "worker version"
);

replaceRequired(
  'const POLL_MS = Math.max(15_000, Number(process.env.GEORGIE_SMARTLEAD_REPLY_POLL_MS || 30_000));',
  'const ACTIVE_POLL_MS = Math.max(15_000, Number(process.env.GEORGIE_SMARTLEAD_REPLY_POLL_MS || 30_000));\nconst IDLE_POLL_MS = Math.max(ACTIVE_POLL_MS, Number(process.env.GEORGIE_SMARTLEAD_REPLY_IDLE_POLL_MS || 60_000));\nconst MAX_BACKOFF_MS = Math.max(IDLE_POLL_MS, Number(process.env.GEORGIE_SMARTLEAD_REPLY_MAX_BACKOFF_MS || 180_000));',
  "poll constants"
);

replaceRequired(
`async function reconcileAccepted(limit = 5) {
  await assertAuthority();
  const rows = await db(\`smartlead_reply_obligations?response_status=eq.queued&metadata->>provider_send_accepted=eq.true&select=*&limit=\${Math.max(1, Math.min(limit, 10))}\`), results = [];
  for (const row of rows || []) {
    try { await assertAuthority(); const job = { ...row, obligation_id: row.id }, leadId = await resolveLeadId(job), receipt = await findSentReceipt(job, leadId, row.metadata?.provider_send_accepted_at || row.updated_at); if (!receipt?.providerMessageId) { results.push({ id: row.id, status: "waiting_receipt" }); continue; } await complete({ ...job, worker_id: WORKER_ID }, row.metadata?.send_reservation || idem(row.id), receipt, { reconciled: true }, "dual_message_history"); console.log("SMARTLEAD_REPLY_CLOSER_RECEIPT", JSON.stringify({ obligationId: row.id, providerMessageId: receipt.providerMessageId, generation: authorityGeneration })); results.push({ id: row.id, status: "reconciled", providerMessageId: receipt.providerMessageId }); }
    catch (error) { if (isStaleAuthorityError(error)) { authorityStale = true; break; } console.error("SMARTLEAD_REPLY_CLOSER_RECEIPT_ERROR", clean(error?.message || error, 500)); results.push({ id: row.id, status: "receipt_error", error: clean(error?.message || error, 300) }); }
  }
  return results;
}`,
`async function reconcileAccepted(limit = 5) {
  const rows = await db(\`smartlead_reply_obligations?response_status=eq.queued&metadata->>provider_send_accepted=eq.true&select=*&limit=\${Math.max(1, Math.min(limit, 10))}\`), results = [];
  if (!Array.isArray(rows) || rows.length === 0) return results;
  await assertAuthority();
  for (const row of rows) {
    try { await assertAuthority(); const job = { ...row, obligation_id: row.id }, leadId = await resolveLeadId(job), receipt = await findSentReceipt(job, leadId, row.metadata?.provider_send_accepted_at || row.updated_at); if (!receipt?.providerMessageId) { results.push({ id: row.id, status: "waiting_receipt" }); continue; } await complete({ ...job, worker_id: WORKER_ID }, row.metadata?.send_reservation || idem(row.id), receipt, { reconciled: true }, "dual_message_history"); console.log("SMARTLEAD_REPLY_CLOSER_RECEIPT", JSON.stringify({ obligationId: row.id, providerMessageId: receipt.providerMessageId, generation: authorityGeneration })); results.push({ id: row.id, status: "reconciled", providerMessageId: receipt.providerMessageId }); }
    catch (error) { if (isStaleAuthorityError(error)) { authorityStale = true; break; } console.error("SMARTLEAD_REPLY_CLOSER_RECEIPT_ERROR", clean(error?.message || error, 500)); results.push({ id: row.id, status: "receipt_error", error: clean(error?.message || error, 300) }); }
  }
  return results;
}`,
  "receipt reconciliation"
);

replaceRequired(
`export function startSmartleadReplyCloserWorker() {
  if (timer || !configured()) { if (!configured()) console.warn("Smartlead reply closer worker not started: Sierra/Smartlead runtime configuration missing"); return; }
  const tick = () => runSmartleadReplyCloserOnce().catch(error => console.error("SMARTLEAD_REPLY_CLOSER_ERROR", clean(error?.stack || error, 1200)));
  activateAuthority().then(async generation => { await heartbeat("heartbeat"); setTimeout(tick, 5_000).unref?.(); timer = setInterval(tick, POLL_MS); timer.unref?.(); console.log(\`Georgie Smartlead threaded reply closer worker online (\${POLL_MS}ms) \${WORKER_VERSION} generation=\${generation} instance=\${INSTANCE_ID}\`); }).catch(error => console.error("SMARTLEAD_REPLY_CLOSER_AUTHORITY_START_ERROR", clean(error?.stack || error, 1200)));
}`,
`export function startSmartleadReplyCloserWorker() {
  if (timer || !configured()) { if (!configured()) console.warn("Smartlead reply closer worker not started: Sierra/Smartlead runtime configuration missing"); return; }
  let backpressureFailures = 0;
  const schedule = delayMs => { if (timer) clearTimeout(timer); timer = setTimeout(tick, delayMs); timer.unref?.(); };
  const tick = async () => {
    let result = null, error = null;
    try { result = await runSmartleadReplyCloserOnce(); }
    catch (caught) { error = caught; console.error("SMARTLEAD_REPLY_CLOSER_ERROR", clean(caught?.stack || caught, 1200)); }
    const next = nextReplyCloserSchedule({ result, error, failures: backpressureFailures, activeMs: ACTIVE_POLL_MS, idleMs: IDLE_POLL_MS, maxBackoffMs: MAX_BACKOFF_MS });
    backpressureFailures = next.failures;
    if (!authorityStale) schedule(next.delayMs);
    if (next.mode === "infra_backoff") console.warn("SMARTLEAD_REPLY_CLOSER_BACKPRESSURE", JSON.stringify({ mode: next.mode, delayMs: next.delayMs, failures: next.failures, version: WORKER_VERSION }));
  };
  activateAuthority().then(async generation => { await heartbeat("heartbeat"); schedule(5_000); console.log(\`Georgie Smartlead threaded reply closer worker online (active=\${ACTIVE_POLL_MS}ms idle=\${IDLE_POLL_MS}ms maxBackoff=\${MAX_BACKOFF_MS}ms) \${WORKER_VERSION} generation=\${generation} instance=\${INSTANCE_ID}\`); }).catch(error => console.error("SMARTLEAD_REPLY_CLOSER_AUTHORITY_START_ERROR", clean(error?.stack || error, 1200)));
}`,
  "adaptive scheduler"
);

replaceRequired(
  'historicalReplyAgeAwareCopy: true, idempotency: "one durable reservation per obligation", healthHeartbeat: true });',
  'historicalReplyAgeAwareCopy: true, idempotency: "one durable reservation per obligation", healthHeartbeat: true, adaptiveBackpressure: true, fixedIntervalPolling: false, idlePollRelaxation: true, transientInfraBackoff: true, maxBackoffMs: MAX_BACKOFF_MS, receiptReconcileReadBeforeAuthorityAssert: true });',
  "worker contract"
);

if (changed) fs.writeFileSync(path, source);
if (!source.includes('georgie.smartlead-reply-closer.v2.5') || !source.includes('nextReplyCloserSchedule') || source.includes('setInterval(tick, POLL_MS)')) throw new Error("Smartlead reply backpressure installation did not converge");
console.log(`[Georgie] Smartlead reply closer adaptive backpressure installed: changed=${changed}`);
