import { searchMemories } from "./memory.js";
import { createTask, listTasks, updateTask } from "./tasks.js";

const LEVELS = {
  read: 0,
  low_risk_write: 1,
  sensitive_write: 2,
  external_side_effect: 3
};

const registry = new Map();

function defineTool(definition) {
  registry.set(definition.name, definition);
}

defineTool({
  name: "memory.search",
  description: "Search Georgie's durable memory for relevant user context.",
  risk: "read",
  async run({ userId, args }) {
    return searchMemories(userId, String(args?.query || ""), Number(args?.limit || 8));
  }
});

defineTool({
  name: "tasks.list",
  description: "List the user's open, completed, or all tasks.",
  risk: "read",
  async run({ userId, args }) {
    return listTasks(userId, { status: args?.status || "open", limit: args?.limit || 30 });
  }
});

defineTool({
  name: "tasks.create",
  description: "Create a task for the user.",
  risk: "low_risk_write",
  async run({ userId, args }) {
    return createTask({ userId, ...(args || {}), source: "georgie-tool" });
  }
});

defineTool({
  name: "tasks.update",
  description: "Update, complete, or cancel a task.",
  risk: "low_risk_write",
  async run({ userId, args }) {
    return updateTask(userId, args?.taskId, args?.patch || {});
  }
});

defineTool({
  name: "system.status",
  description: "Inspect currently configured Georgie capabilities.",
  risk: "read",
  async run() {
    return {
      voice: true,
      memory: true,
      handsFree: true,
      tasks: true,
      externalConnectors: {
        email: Boolean(process.env.GEORGIE_EMAIL_ENABLED === "true"),
        calendar: Boolean(process.env.GEORGIE_CALENDAR_ENABLED === "true"),
        web: Boolean(process.env.GEORGIE_WEB_ENABLED === "true"),
        notifications: Boolean(process.env.GEORGIE_NOTIFICATIONS_ENABLED === "true")
      }
    };
  }
});

export function listToolDefinitions() {
  return [...registry.values()].map(({ name, description, risk }) => ({ name, description, risk }));
}

export function canAutoExecute(risk, policy = "low_risk_write") {
  return LEVELS[risk] <= LEVELS[policy];
}

export async function executeTool({ name, args, userId, policy = "low_risk_write" }) {
  const tool = registry.get(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  if (!canAutoExecute(tool.risk, policy)) {
    return {
      ok: false,
      approvalRequired: true,
      tool: name,
      risk: tool.risk,
      args
    };
  }
  try {
    const result = await tool.run({ userId, args });
    return { ok: true, tool: name, risk: tool.risk, result };
  } catch (error) {
    return { ok: false, tool: name, error: error instanceof Error ? error.message : "Tool execution failed" };
  }
}
