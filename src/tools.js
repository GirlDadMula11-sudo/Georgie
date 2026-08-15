import { searchMemories } from "./memory.js";
import { createTask, listTasks, updateTask } from "./tasks.js";
import { enqueueMacJob, listMacJobs } from "./mac/queue.js";
import {
  listNeoMailboxes,
  listRecentMessages,
  neoMailConfigured,
  readMessage,
  searchMessages,
  sendMessage,
  verifyNeoMailbox
} from "./integrations/neo-mail.js";

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
  name: "mac.jobs",
  description: "List recent jobs executed or queued for the user's Georgie Mac Agent.",
  risk: "read",
  async run({ userId, args }) {
    return listMacJobs(userId, Number(args?.limit || 30));
  }
});

defineTool({
  name: "mac.system_info",
  description: "Ask the user's connected Mac for hostname, architecture, OS release and uptime.",
  risk: "read",
  async run({ userId, args }) {
    return enqueueMacJob({ userId, deviceId: args?.deviceId || "primary-mac", action: "system.info", risk: "read", reason: "System status requested by Georgie" });
  }
});

defineTool({
  name: "mac.clipboard_read",
  description: "Read text currently on the connected Mac clipboard.",
  risk: "read",
  async run({ userId, args }) {
    return enqueueMacJob({ userId, deviceId: args?.deviceId || "primary-mac", action: "clipboard.read", risk: "read", reason: "Clipboard requested by Georgie" });
  }
});

defineTool({
  name: "mac.file_read",
  description: "Read a text file from the connected Mac Desktop, Documents, or Downloads folder.",
  risk: "read",
  async run({ userId, args }) {
    return enqueueMacJob({ userId, deviceId: args?.deviceId || "primary-mac", action: "file.read", args: { path: args?.path }, risk: "read", reason: "File requested by Georgie" });
  }
});

defineTool({
  name: "mac.open_app",
  description: "Open an allowlisted application on the connected Mac.",
  risk: "low_risk_write",
  async run({ userId, args }) {
    return enqueueMacJob({ userId, deviceId: args?.deviceId || "primary-mac", action: "app.open", args: { app: args?.app }, risk: "low_risk_write", reason: "Application launch requested by Georgie" });
  }
});

defineTool({
  name: "mac.open_url",
  description: "Open an HTTP or HTTPS URL on the connected Mac.",
  risk: "low_risk_write",
  async run({ userId, args }) {
    return enqueueMacJob({ userId, deviceId: args?.deviceId || "primary-mac", action: "url.open", args: { url: args?.url }, risk: "low_risk_write", reason: "Web page requested by Georgie" });
  }
});

defineTool({
  name: "mac.clipboard_write",
  description: "Put text onto the connected Mac clipboard.",
  risk: "low_risk_write",
  async run({ userId, args }) {
    return enqueueMacJob({ userId, deviceId: args?.deviceId || "primary-mac", action: "clipboard.write", args: { text: args?.text }, risk: "low_risk_write", reason: "Clipboard update requested by Georgie" });
  }
});

defineTool({
  name: "mac.notification",
  description: "Show a local notification on the connected Mac.",
  risk: "low_risk_write",
  async run({ userId, args }) {
    return enqueueMacJob({ userId, deviceId: args?.deviceId || "primary-mac", action: "notification.show", args: { title: args?.title, body: args?.body }, risk: "low_risk_write", reason: "Notification requested by Georgie" });
  }
});

defineTool({
  name: "email.accounts",
  description: "List the user's configured Neo Mail mailboxes and their business roles.",
  risk: "read",
  async run() {
    return listNeoMailboxes();
  }
});

defineTool({
  name: "email.verify",
  description: "Verify secure IMAP and SMTP connectivity for a configured Neo Mail mailbox.",
  risk: "read",
  async run({ args }) {
    return verifyNeoMailbox(args?.mailboxId);
  }
});

defineTool({
  name: "email.list",
  description: "List recent Neo Mail inbox messages. Supports unseen-only filtering.",
  risk: "read",
  async run({ args }) {
    return listRecentMessages(args?.mailboxId, {
      limit: args?.limit || 20,
      unseenOnly: Boolean(args?.unseenOnly)
    });
  }
});

defineTool({
  name: "email.search",
  description: "Search a Neo Mail mailbox by sender, recipient, subject, or message body.",
  risk: "read",
  async run({ args }) {
    return searchMessages(args?.mailboxId, { query: args?.query || "", limit: args?.limit || 25 });
  }
});

defineTool({
  name: "email.read",
  description: "Read the content and attachment metadata for one Neo Mail message.",
  risk: "read",
  async run({ args }) {
    return readMessage(args?.mailboxId, args?.uid, { markSeen: Boolean(args?.markSeen) });
  }
});

defineTool({
  name: "email.send",
  description: "Send an email through a configured Neo Mail mailbox. This creates an external communication and requires external-side-effect authorization.",
  risk: "external_side_effect",
  async run({ args }) {
    return sendMessage(args?.mailboxId, {
      to: args?.to,
      cc: args?.cc,
      bcc: args?.bcc,
      subject: args?.subject,
      text: args?.text,
      html: args?.html,
      replyTo: args?.replyTo
    });
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
      proactive: true,
      macAgent: Boolean(process.env.GEORGIE_MAC_AGENT_TOKEN),
      externalConnectors: {
        neoMail: neoMailConfigured(),
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
