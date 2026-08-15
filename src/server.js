import "dotenv/config";
import express from "express";
import { askGeorgie } from "./georgie.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, assistant: "Georgie", version: "0.1.0" });
});

app.post("/api/respond", async (req, res) => {
  try {
    const { input, history = [] } = req.body ?? {};
    const result = await askGeorgie(input, history);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Georgie is listening on http://localhost:${port}`);
});
