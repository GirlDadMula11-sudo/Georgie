import fs from "node:fs";

const path = "src/smartlead-reply-closer-worker.js";
let source = fs.readFileSync(path, "utf8");
let changed = false;

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Smartlead authority recovery installer missing ${label} anchor`);
  source = source.replace(from, to);
  changed = true;
}

replaceRequired(
  'const WORKER_VERSION = "georgie.smartlead-reply-closer.v2.5";',
  'const WORKER_VERSION = "georgie.smartlead-reply-closer.v2.5.1";',
  "worker version"
);

replaceRequired(
  'let timer = null;\nlet running = false;',
  'let timer = null;\nlet authorityRetryTimer = null;\nlet running = false;',
  "authority retry timer"
);

replaceRequired(
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
`export function startSmartleadReplyCloserWorker() {
  if (timer || authorityRetryTimer || !configured()) { if (!configured()) console.warn("Smartlead reply closer worker not started: Sierra/Smartlead runtime configuration missing"); return; }
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
  const retryDelays = [5_000, 10_000, 20_000, 30_000, 60_000];
  let retryAttempt = 0;
  const activate = async () => {
    authorityRetryTimer = null;
    try {
      const generation = await activateAuthority();
      retryAttempt = 0;
      await heartbeat("heartbeat");
      schedule(5_000);
      console.log(\`Georgie Smartlead threaded reply closer worker online (active=\${ACTIVE_POLL_MS}ms idle=\${IDLE_POLL_MS}ms maxBackoff=\${MAX_BACKOFF_MS}ms) \${WORKER_VERSION} generation=\${generation} instance=\${INSTANCE_ID}\`);
    } catch (error) {
      const delayMs = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];
      retryAttempt += 1;
      console.error("SMARTLEAD_REPLY_CLOSER_AUTHORITY_START_ERROR", clean(error?.stack || error, 1200), \`retry_in_ms=\${delayMs}\`);
      authorityRetryTimer = setTimeout(activate, delayMs);
      authorityRetryTimer.unref?.();
    }
  };
  void activate();
}`,
  "authority startup recovery"
);

replaceRequired(
  'historicalReplyAgeAwareCopy: true, idempotency: "one durable reservation per obligation", healthHeartbeat: true, adaptiveBackpressure: true, fixedIntervalPolling: false, idlePollRelaxation: true, transientInfraBackoff: true, maxBackoffMs: MAX_BACKOFF_MS, receiptReconcileReadBeforeAuthorityAssert: true });',
  'historicalReplyAgeAwareCopy: true, idempotency: "one durable reservation per obligation", healthHeartbeat: true, adaptiveBackpressure: true, fixedIntervalPolling: false, idlePollRelaxation: true, transientInfraBackoff: true, maxBackoffMs: MAX_BACKOFF_MS, receiptReconcileReadBeforeAuthorityAssert: true, authorityActivationRetry: true, authorityActivationFailClosed: true });',
  "authority recovery contract"
);

if (changed) fs.writeFileSync(path, source);

if (!source.includes('georgie.smartlead-reply-closer.v2.5.1') || !source.includes('authorityRetryTimer') || !source.includes('authorityActivationRetry: true')) {
  throw new Error("Smartlead authority recovery installation did not converge");
}

console.log(`[Georgie] Smartlead reply closer authority recovery installed: changed=${changed}`);
