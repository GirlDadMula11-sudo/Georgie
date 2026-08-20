import { askGeorgie, extractMemoryCandidates, planActions } from "./georgie.js";
import { addMemory, appendSessionTurn, buildMemoryContext, getSessionHistory } from "./memory.js";
import { listTasks } from "./tasks.js";
import { deterministicToolPlan } from "./fast-intents.js";
import { executeTool, listToolDefinitions } from "./tools.js";

function toolRiskMap() {
  return new Map(listToolDefinitions().map((tool) => [tool.name, tool.risk]));
}

async function planFor(input) {
  const deterministic = deterministicToolPlan(input);
  if (deterministic.length) return deterministic;
  return planActions(input, listToolDefinitions());
}

async function executePlannedActions(userId, input) {
  const actions = await planFor(input);
  if (!actions.length) return [];
  const policy = process.env.GEORGIE_AUTO_ACTION_POLICY || "low_risk_write";
  const risks = toolRiskMap();
  const readActions = actions.filter((a) => risks.get(a.tool) === "read");
  const writeActions = actions.filter((a) => risks.get(a.tool) !== "read");

  const readResults = await Promise.all(
    readActions.map((action) => executeTool({
      name: action.tool,
      args: action.args || {},
      userId,
      policy
    }))
  );

  const writeResults = [];
  for (const action of writeActions) {
    writeResults.push(await executeTool({
      name: action.tool,
      args: action.args || {},
      userId,
      policy
    }));
  }

  return [...readResults, ...writeResults];
}

function backgroundLearn({ userId, sessionId, input, responseText }) {
  setImmediate(async () => {
    try {
      await Promise.all([
        appendSessionTurn({ userId, sessionId, role: "user", content: input }),
        appendSessionTurn({ userId, sessionId, role: "assistant", content: responseText })
      ]);
    } catch (error) {
      console.warn("Georgie v2 history persistence delayed:", error instanceof Error ? error.message : error);
    }

    try {
      const memories = await extractMemoryCandidates(input, responseText);
      await Promise.all(memories.map((memory) => addMemory({
        userId,
        ...memory,
        source: "auto-extracted-v2"
      })));
    } catch (error) {
      console.warn("Georgie v2 memory learning delayed:", error instanceof Error ? error.message : error);
    }
  });
}

export async function completeTurnV2({ userId, sessionId, input, history = [] }) {
  const startedAt = Date.now();
  const suppliedHistory = Array.isArray(history) && history.length ? history : null;

  const [persistedHistory, memory, taskSnapshot, toolResults] = await Promise.all([
    suppliedHistory ? Promise.resolve(suppliedHistory) : getSessionHistory(userId, sessionId, 12),
    buildMemoryContext(userId, input),
    listTasks(userId, { status: "open", limit: 6 }),
    executePlannedActions(userId, input)
  ]);

  const contextParts = [];
  if (memory?.prompt) contextParts.push(memory.prompt);
  if (taskSnapshot?.length) {
    contextParts.push(`OPEN TASKS\n${taskSnapshot.map((task) => `- ${task.title}${task.dueAt ? ` (due ${task.dueAt})` : ""}`).join("\n")}`);
  }
  if (toolResults?.length) {
    contextParts.push(`TOOL EXECUTION RESULTS\n${JSON.stringify(toolResults).slice(0, 14000)}`);
  }

  const response = await askGeorgie(
    input,
    Array.isArray(persistedHistory) ? persistedHistory.slice(-12) : [],
    contextParts.join("\n\n")
  );

  backgroundLearn({ userId, sessionId, input, responseText: response.text });

  return {
    ...response,
    remembered: 0,
    memoryCount: Array.isArray(memory?.memories) ? memory.memories.length : 0,
    actions: toolResults,
    engine: "v2-concurrent",
    latencyMs: Date.now() - startedAt
  };
}
