import { enqueueEvent } from "./events.js";
import { listAllTasks } from "./tasks.js";
import { getSierraHealth, getSierraNetworkGaps, getSierraStrategy, sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";

let timer = null;
let lastTaskSweepAt = 0;
let lastSierraHealthAt = 0;
let lastNetworkSweepAt = 0;
let lastStrategySweepAt = 0;
let sierraFailures = 0;

const TASK_INTERVAL = Number(process.env.GEORGIE_TASK_SWEEP_MS || 60_000);
const HEALTH_INTERVAL = Number(process.env.GEORGIE_SIERRA_HEALTH_MS || 5 * 60_000);
const NETWORK_INTERVAL = Number(process.env.GEORGIE_SIERRA_NETWORK_MS || 60 * 60_000);
const STRATEGY_INTERVAL = Number(process.env.GEORGIE_SIERRA_STRATEGY_MS || 6 * 60 * 60_000);

function sierraBackoff() {
  if (!sierraFailures) return 1;
  return Math.min(12, 2 ** Math.min(sierraFailures, 4));
}

async function sweepTasks(now) {
  if (now - lastTaskSweepAt < TASK_INTERVAL) return;
  lastTaskSweepAt = now;
  const leadMs = Number(process.env.GEORGIE_REMINDER_LEAD_MS || 10 * 60 * 1000);
  const tasks = await listAllTasks({ status: "open", limit: 5000 });
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const due = new Date(task.dueAt).getTime();
    if (!Number.isFinite(due) || due - now > leadMs || now - due > 24 * 60 * 60 * 1000) continue;
    const overdue = due < now;
    await enqueueEvent({
      userId: task.userId,
      type: overdue ? "task.overdue" : "task.due_soon",
      title: overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`,
      body: task.notes || "",
      priority: task.priority === "urgent" ? "urgent" : "high",
      dedupeKey: `${task.id}:${task.dueAt}:${overdue ? "overdue" : "due"}`,
      data: { taskId: task.id, dueAt: task.dueAt }
    });
  }
}

async function sweepSierra(now) {
  if (!sierraWorkforceConfigured()) return;
  const executiveUser = process.env.GEORGIE_EXECUTIVE_USER_ID || "primary";
  const backoff = sierraBackoff();

  try {
    if (process.env.GEORGIE_MAINTENANCE_ENABLED === "false" && now - lastSierraHealthAt >= HEALTH_INTERVAL * backoff) {
      lastSierraHealthAt = now;
      const health = await getSierraHealth(executiveUser);
      sierraFailures = 0;
      const status = health?.health_status || health?.healthStatus || health?.status;
      if (status && status !== "healthy") {
        await enqueueEvent({
          userId: executiveUser,
          type: "sierra.health_attention",
          title: "Sierra operations needs attention",
          body: "Georgie detected a meaningful Sierra operations-health degradation and preserved the underlying evidence for diagnosis.",
          priority: "high",
          dedupeKey: `sierra-health:${status}:${new Date().toISOString().slice(0, 13)}`,
          data: { health }
        });
      }
    }

    if (now - lastNetworkSweepAt >= NETWORK_INTERVAL * backoff) {
      lastNetworkSweepAt = now;
      const network = await getSierraNetworkGaps(executiveUser);
      const gaps = Array.isArray(network?.gaps) ? network.gaps : [];
      for (const gap of gaps.filter((x) => Number(x?.urgency || 0) >= 85 && ["researching", "outreach_started", "candidate_ready"].includes(String(x?.status || "")))) {
        await enqueueEvent({
          userId: executiveUser,
          type: "sierra.network_opportunity",
          title: `Lender-network opportunity: ${gap.product_name}`,
          body: `Sierra identified a high-value product-network gap with urgency ${gap.urgency}.`,
          priority: "normal",
          dedupeKey: `sierra-network-gap:${gap.id}:${gap.status}`,
          data: { gap }
        });
      }
    }

    if (now - lastStrategySweepAt >= STRATEGY_INTERVAL * backoff) {
      lastStrategySweepAt = now;
      const strategy = await getSierraStrategy(executiveUser);
      const recommendations = Array.isArray(strategy?.recommendations) ? strategy.recommendations : [];
      for (const item of recommendations.filter((x) => Number(x?.priority_score || 0) >= 75 && Number(x?.confidence || 0) >= 0.75).slice(0, 3)) {
        await enqueueEvent({
          userId: executiveUser,
          type: "sierra.strategy_insight",
          title: item.title || "Sierra strategic insight",
          body: item.summary || item.recommendation || "High-confidence strategic opportunity detected.",
          priority: "normal",
          dedupeKey: `sierra-strategy:${item.id}`,
          data: { recommendation: item }
        });
      }
    }
  } catch (error) {
    sierraFailures += 1;
    console.warn(`Sierra proactive sweep failed; adaptive backoff x${sierraBackoff()}:`, error instanceof Error ? error.message : error);
  }
}

async function sweep() {
  const now = Date.now();
  try { await sweepTasks(now); } catch (error) { console.warn("Task sweep failed:", error instanceof Error ? error.message : error); }
  await sweepSierra(now);
}

export function startProactiveEngine() {
  if (timer) return;
  const intervalMs = Math.max(15_000, Number(process.env.GEORGIE_PROACTIVE_INTERVAL_MS || 30_000));
  sweep();
  timer = setInterval(sweep, intervalMs);
  timer.unref?.();
}

export function stopProactiveEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}
