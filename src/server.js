import "dotenv/config";
import express from "express";
import multer from "multer";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { askGeorgie, extractMemoryCandidates, planActions, synthesizeSpeech, transcribeAudio } from "./georgie.js";
import {
  addMemory,
  appendSessionTurn,
  buildMemoryContext,
  deleteMemory,
  getProfile,
  getSessionHistory,
  listMemories,
  searchMemories,
  updateProfile
} from "./memory.js";
import { createTask, deleteTask, listTasks, updateTask } from "./tasks.js";
import { acknowledgeEvent, listEvents } from "./events.js";
import { startProactiveEngine } from "./proactive.js";
import { startEmailIntelligence, sweepNeoMail } from "./email-worker.js";
import { listNeoMailboxes, neoMailConfigured, verifyNeoMailbox } from "./integrations/neo-mail.js";
import { executeTool, listToolDefinitions } from "./tools.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"]
    }
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: Number(process.env.GEORGIE_RATE_LIMIT || 90), standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static("public", { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

function getUserId(req) {
  return String(req.headers["x-georgie-user"] || req.body?.userId || req.query?.userId || process.env.GEORGIE_PRIMARY_USER_ID || "primary").slice(0, 100);
}

function getSessionId(req) {
  return String(req.headers["x-georgie-session"] || req.body?.sessionId || req.query?.sessionId || "default").slice(0, 150);
}

async function rememberTurn(userId, userText, assistantText) {
  try {
    const candidates = await extractMemoryCandidates(userText, assistantText);
    await Promise.all(candidates.map((memory) => addMemory({ userId, ...memory, source: "auto-extracted" })));
    return candidates.length;
  } catch (error) {
    console.warn("Memory extraction skipped:", error instanceof Error ? error.message : error);
    return 0;
  }
}

async function runPlannedActions(userId, input) {
  const actions = await planActions(input, listToolDefinitions());
  const policy = process.env.GEORGIE_AUTO_ACTION_POLICY || "low_risk_write";
  const results = [];
  for (const action of actions) {
    results.push(await executeTool({ name: action.tool, args: action.args || {}, userId, policy }));
  }
  return results;
}

async function completeTurn({ userId, sessionId, input, history = [] }) {
  const persistedHistory = history?.length ? history : await getSessionHistory(userId, sessionId, 16);
  const memory = await buildMemoryContext(userId, input);
  const toolResults = await runPlannedActions(userId, input);
  const taskSnapshot = await listTasks(userId, { status: "open", limit: 8 });
  const contextParts = [memory.prompt];
  if (taskSnapshot.length) contextParts.push(`OPEN TASKS\n${taskSnapshot.map((task) => `- ${task.title}${task.dueAt ? ` (due ${task.dueAt})` : ""}`).join("\n")}`);
  if (toolResults.length) contextParts.push(`TOOL EXECUTION RESULTS\n${JSON.stringify(toolResults).slice(0, 10000)}`);
  const response = await askGeorgie(input, persistedHistory, contextParts.filter(Boolean).join("\n\n"));
  await appendSessionTurn({ userId, sessionId, role: "user", content: input });
  await appendSessionTurn({ userId, sessionId, role: "assistant", content: response.text });
  const remembered = await rememberTurn(userId, input, response.text);
  return { ...response, remembered, memoryCount: memory.memories.length, actions: toolResults };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    assistant: "Georgie",
    version: "0.7.0",
    voice: true,
    memory: true,
    identity: true,
    wakeName: true,
    handsFree: true,
    bargeIn: true,
    tasks: true,
    toolRouter: true,
    proactiveEngine: true,
    neoMail: neoMailConfigured(),
    emailIntelligence: neoMailConfigured(),
    liveWebResearch: process.env.GEORGIE_WEB_ENABLED !== "false",
    pwa: true,
    productionSecurity: true,
    configured: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.get("/api/tools", (_req, res) => res.json({ ok: true, tools: listToolDefinitions() }));

app.get("/api/mail/accounts", (_req, res) => {
  try { res.json({ ok: true, provider: "neo", configured: neoMailConfigured(), accounts: listNeoMailboxes() }); }
  catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.post("/api/mail/verify/:id", async (req, res) => {
  try { res.json({ ok: true, result: await verifyNeoMailbox(req.params.id) }); }
  catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Neo Mail verification failed" }); }
});

app.post("/api/mail/sweep", async (_req, res) => {
  try { await sweepNeoMail(); res.json({ ok: true }); }
  catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Neo Mail sweep failed" }); }
});

app.get("/api/profile", async (req, res) => {
  try { res.json({ ok: true, profile: await getProfile(getUserId(req)) }); }
  catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.patch("/api/profile", async (req, res) => {
  try { res.json({ ok: true, profile: await updateProfile(getUserId(req), req.body?.profile || req.body || {}) }); }
  catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.get("/api/memories", async (req, res) => {
  try {
    const userId = getUserId(req);
    const query = String(req.query?.q || "");
    const memories = query ? await searchMemories(userId, query, Number(req.query?.limit || 50)) : await listMemories(userId, Number(req.query?.limit || 100));
    res.json({ ok: true, memories });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.post("/api/memories", async (req, res) => {
  try {
    const memory = await addMemory({ userId: getUserId(req), ...(req.body || {}), source: "explicit" });
    if (!memory) return res.status(400).json({ ok: false, error: "Memory text is required" });
    res.status(201).json({ ok: true, memory });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.delete("/api/memories/:id", async (req, res) => {
  try {
    const removed = await deleteMemory(getUserId(req), req.params.id);
    res.status(removed ? 200 : 404).json({ ok: removed });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.get("/api/tasks", async (req, res) => {
  try { res.json({ ok: true, tasks: await listTasks(getUserId(req), { status: req.query?.status || "open", limit: req.query?.limit || 50 }) }); }
  catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.post("/api/tasks", async (req, res) => {
  try { res.status(201).json({ ok: true, task: await createTask({ userId: getUserId(req), ...(req.body || {}), source: "explicit" }) }); }
  catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.patch("/api/tasks/:id", async (req, res) => {
  try {
    const task = await updateTask(getUserId(req), req.params.id, req.body || {});
    res.status(task ? 200 : 404).json({ ok: Boolean(task), task });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const removed = await deleteTask(getUserId(req), req.params.id);
    res.status(removed ? 200 : 404).json({ ok: removed });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.get("/api/events", async (req, res) => {
  try { res.json({ ok: true, events: await listEvents(getUserId(req), { status: req.query?.status || "pending", limit: req.query?.limit || 30 }) }); }
  catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.post("/api/events/:id/ack", async (req, res) => {
  try {
    const event = await acknowledgeEvent(getUserId(req), req.params.id);
    res.status(event ? 200 : 404).json({ ok: Boolean(event), event });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.get("/api/session", async (req, res) => {
  try { res.json({ ok: true, history: await getSessionHistory(getUserId(req), getSessionId(req), Number(req.query?.limit || 40)) }); }
  catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "Audio file is required" });
    const text = await transcribeAudio({ buffer: req.file.buffer, mimeType: req.file.mimetype, filename: req.file.originalname });
    res.json({ ok: true, text });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.post("/api/respond", async (req, res) => {
  try {
    const { input, history = [] } = req.body ?? {};
    if (!input?.trim()) return res.status(400).json({ ok: false, error: "Input is required" });
    res.json({ ok: true, ...(await completeTurn({ userId: getUserId(req), sessionId: getSessionId(req), input: input.trim(), history })) });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.post("/api/speak", async (req, res) => {
  try {
    const audio = await synthesizeSpeech(req.body?.text);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audio);
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.post("/api/voice-turn", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "Audio file is required" });
    const userId = getUserId(req);
    const sessionId = getSessionId(req);
    const history = req.body?.history ? JSON.parse(req.body.history) : [];
    const transcript = await transcribeAudio({ buffer: req.file.buffer, mimeType: req.file.mimetype, filename: req.file.originalname });
    const response = await completeTurn({ userId, sessionId, input: transcript, history });
    const speech = await synthesizeSpeech(response.text);
    res.json({
      ok: true,
      transcript,
      text: response.text,
      responseId: response.responseId,
      remembered: response.remembered,
      memoryCount: response.memoryCount,
      actions: response.actions,
      webSearches: response.webSearches || 0,
      audioBase64: speech.toString("base64"),
      audioMimeType: "audio/mpeg"
    });
  } catch (error) { res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: "Georgie encountered an internal error." });
});

startProactiveEngine();
startEmailIntelligence();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Georgie is listening on http://localhost:${port}`));
