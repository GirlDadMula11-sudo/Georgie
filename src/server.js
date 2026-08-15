import "dotenv/config";
import express from "express";
import multer from "multer";
import { askGeorgie, extractMemoryCandidates, synthesizeSpeech, transcribeAudio } from "./georgie.js";
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

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

function getUserId(req) {
  return String(req.headers["x-georgie-user"] || req.body?.userId || req.query?.userId || "primary").slice(0, 100);
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

async function completeTurn({ userId, sessionId, input, history = [] }) {
  const persistedHistory = history?.length ? history : await getSessionHistory(userId, sessionId, 16);
  const memory = await buildMemoryContext(userId, input);
  const response = await askGeorgie(input, persistedHistory, memory.prompt);

  await appendSessionTurn({ userId, sessionId, role: "user", content: input });
  await appendSessionTurn({ userId, sessionId, role: "assistant", content: response.text });
  const remembered = await rememberTurn(userId, input, response.text);

  return {
    ...response,
    remembered,
    memoryCount: memory.memories.length
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    assistant: "Georgie",
    version: "0.3.0",
    voice: true,
    memory: true,
    identity: true,
    configured: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.get("/api/profile", async (req, res) => {
  try {
    res.json({ ok: true, profile: await getProfile(getUserId(req)) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.patch("/api/profile", async (req, res) => {
  try {
    const profile = await updateProfile(getUserId(req), req.body?.profile || req.body || {});
    res.json({ ok: true, profile });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/memories", async (req, res) => {
  try {
    const userId = getUserId(req);
    const query = String(req.query?.q || "");
    const memories = query
      ? await searchMemories(userId, query, Number(req.query?.limit || 50))
      : await listMemories(userId, Number(req.query?.limit || 100));
    res.json({ ok: true, memories });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/memories", async (req, res) => {
  try {
    const memory = await addMemory({ userId: getUserId(req), ...(req.body || {}), source: "explicit" });
    if (!memory) return res.status(400).json({ ok: false, error: "Memory text is required" });
    res.status(201).json({ ok: true, memory });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/memories/:id", async (req, res) => {
  try {
    const removed = await deleteMemory(getUserId(req), req.params.id);
    res.status(removed ? 200 : 404).json({ ok: removed });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/session", async (req, res) => {
  try {
    const history = await getSessionHistory(getUserId(req), getSessionId(req), Number(req.query?.limit || 40));
    res.json({ ok: true, history });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "Audio file is required" });
    const text = await transcribeAudio({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname
    });
    res.json({ ok: true, text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/respond", async (req, res) => {
  try {
    const { input, history = [] } = req.body ?? {};
    if (!input?.trim()) return res.status(400).json({ ok: false, error: "Input is required" });
    const result = await completeTurn({
      userId: getUserId(req),
      sessionId: getSessionId(req),
      input: input.trim(),
      history
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/speak", async (req, res) => {
  try {
    const { text } = req.body ?? {};
    const audio = await synthesizeSpeech(text);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audio);
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/voice-turn", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "Audio file is required" });

    const userId = getUserId(req);
    const sessionId = getSessionId(req);
    const history = req.body?.history ? JSON.parse(req.body.history) : [];
    const transcript = await transcribeAudio({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname
    });
    const response = await completeTurn({ userId, sessionId, input: transcript, history });
    const speech = await synthesizeSpeech(response.text);

    res.json({
      ok: true,
      transcript,
      text: response.text,
      responseId: response.responseId,
      remembered: response.remembered,
      memoryCount: response.memoryCount,
      audioBase64: speech.toString("base64"),
      audioMimeType: "audio/mpeg"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Georgie is listening on http://localhost:${port}`);
});
