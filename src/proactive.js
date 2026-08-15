import { enqueueEvent } from "./events.js";
import { listAllTasks } from "./tasks.js";

let timer = null;

async function sweep() {
  try {
    const now = Date.now();
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
