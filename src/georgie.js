const OPENAI_BASE_URL = "https://api.openai.com/v1";

const SYSTEM_PROMPT = `You are Georgie, a sophisticated personal AI assistant.
You are fast, calm, capable, proactive, and highly practical.
Your job is to understand the user's goal, reason carefully, guide them toward the best next action, and use connected capabilities when available.
Keep spoken responses natural and concise unless detail is requested.
Never pretend an external action succeeded unless the system confirms it.`;

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return process.env.OPENAI_API_KEY;
}

async function openAI(path, options = {}) {
  const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  return response;
}

function extractResponseText(payload) {
  if (payload.output_text) return payload.output_text;

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }

  return "";
}

export async function askGeorgie(input, history = []) {
  if (!input?.trim()) throw new Error("Input is required");

  const safeHistory = Array.isArray(history)
    ? history
        .slice(-12)
        .filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    : [];

  const response = await openAI("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5",
      instructions: SYSTEM_PROMPT,
      input: [...safeHistory, { role: "user", content: input.trim() }]
    })
  });

  const payload = await response.json();
  const text = extractResponseText(payload);

  if (!text) throw new Error("Georgie returned an empty response");

  return { text, responseId: payload.id };
}

export async function transcribeAudio({ buffer, mimeType, filename }) {
  if (!buffer?.length) throw new Error("Audio is required");

  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  form.append("file", new Blob([buffer], { type: mimeType || "audio/webm" }), filename || "voice.webm");

  const response = await openAI("/audio/transcriptions", {
    method: "POST",
    body: form
  });

  const payload = await response.json();
  if (!payload.text?.trim()) throw new Error("No speech was detected");

  return payload.text.trim();
}

export async function synthesizeSpeech(text) {
  if (!text?.trim()) throw new Error("Text is required for speech synthesis");

  const response = await openAI("/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.OPENAI_VOICE || "cedar",
      input: text.slice(0, 4096),
      response_format: "mp3",
      instructions: "Speak naturally, confidently, warmly, and efficiently. Sound like a highly capable personal assistant."
    })
  });

  return Buffer.from(await response.arrayBuffer());
}
