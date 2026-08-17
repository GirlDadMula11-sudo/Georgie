import { enqueueEvent } from "./events.js";
import { listAllTasks } from "./tasks.js";
import { getSierraHealth, getSierraNetworkGaps, getSierraStrategy, sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";

let timer = null;
let lastSierraSweepAt = 0;
let lastStrategySweepAt = 0;

async function sweepTasks(now) {
  const leadMs = Number(process.env.GEORGIE_REMINDER_LEAD_MS || 10 * 60 * 1000);
  const tasks = await listAllTasks({ status: "open", limit: 5000 });
  for (const task of tasks) {
    if (!task.dueAt) continue;
    const due = new Date(task.dueAt).getTime();
    if (!Number.isFinite(due)) continue;
    if (due - now > leadMs) continue;
    if (now - due > 24 * 60 * 60 * 1000) continue;
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

  // Health is checked frequently, but Georgie only interrupts on a meaningful degradation.
  if (now - lastSierraSweepAt >= 15 * 60 * 1000) {
    lastSierraSweepAt = now;
    const health = await getSierraHealth(executiveUser);
    const status = health?.health_status || health?.healthStatus || health?.status;
    if (status && status !== "healthy") {
      await enqueueEvent({
        userId: executiveUser,
        type: "sierra.health_attention",
        title: "Sierra operations needs attention",
        body: "Georgie detected a meaningful Sierra operations-health degradation. Review the canonical health snapshot before taking action.",
        priority: "high",
        dedupeKey: `sierra-health:${status}:${new Date().toISOString().slice(0, 13)}`,
        data: { health }
      });
    }

    const network = await getSierraNetworkGaps(executiveUser);
    const gaps = Array.isArray(network?.gaps) ? network.gaps : [];
    for (const gap of gaps.filter((x) => Number(x?.urgency || 0) >= 85 && ["researching", "outreach_started", "candidate_ready"].includes(String(x?.status || "")))) {
      await enqueueEvent({
        userId: executiveUser,
        type: "sierra.network_opportunity",
        title: `Lender-network opportunity: ${gap.product_name}`,
        body: `Sierra identified a high-value product-network gap with urgency ${gap.urgency}. Georgie will surface it only when the status meaningfully changes.`,
        priority: "normal",
        dedupeKey: `sierra-network-gap:${gap.id}:${gap.status}`,
        data: { gap }
      });
    }
  }

  // Strategy is deliberately low-frequency and only surfaces high-impact, high-confidence ideas.
  if (now - lastStrategySweepAt >= 12 * 60 * 60 * 1000) {
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
}

async function sweep() {
  try {
    const now = Date.now();
    await sweepTasks(now);
    await sweepSierra(now);
  } catch (error) {
    console.warn("Proactive sweep failed:", error instanceof Error ? error.message : error);
  }
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
