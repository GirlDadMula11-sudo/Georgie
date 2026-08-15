import "dotenv/config";
import express from "express";
import multer from "multer";
import { askGeorgie, synthesizeSpeech, transcribeAudio } from "./georgie.js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    assistant: "Georgie",
    version: "0.2.0",
    voice: true,
    configured: Boolean(process.env.OPENAI_API_KEY)
  });
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
    const result = await askGeorgie(input, history);
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

    const history = req.body?.history ? JSON.parse(req.body.history) : [];
    const transcript = await transcribeAudio({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      filename: req.file.originalname
    });
    const response = await askGeorgie(transcript, history);
    const speech = await synthesizeSpeech(response.text);

    res.json({
      ok: true,
      transcript,
      text: response.text,
      responseId: response.responseId,
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
