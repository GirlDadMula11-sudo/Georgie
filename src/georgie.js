const OPENAI_BASE_URL = "https://api.openai.com/v1";

const SYSTEM_PROMPT = `You are Georgie, a sophisticated personal AI assistant.
You are fast, calm, capable, proactive, and highly practical.
Your job is to understand the user's goal, reason carefully, guide them toward the best next action, and use connected capabilities when available.
Use provided memory, identity, task, and tool context naturally when relevant, but do not force it into unrelated answers.
Treat memories as context that may become outdated. If a current user statement conflicts with an older memory, prefer the current statement.
Never claim an action succeeded unless the system confirms it.
When an action requires approval or a connector is unavailable, state that clearly and continue helping with what is available.
Keep spoken responses natural and concise unless detail is requested.`;

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  return process.env.OPENAI_API_KEY;
}

async function openAI(path, options = {}) {
  const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${requireApiKey()}`, ...(options.headers || {}) }
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

async function jsonResponse({ model, instructions, input }) {
  const response = await openAI("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions, input })
  });
  const payload = await response.json();
  const raw = extractResponseText(payload).trim();
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

export async function askGeorgie(input, history = [], context = "") {
  if (!input?.trim()) throw new Error("Input is required");
  const safeHistory = Array.isArray(history)
    ? history.slice(-16).filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
    : [];
  const instructions = context ? `${SYSTEM_PROMPT}\n\nCURRENT CONTEXT\n${context}` : SYSTEM_PROMPT;
  const response = await openAI("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5",
      instructions,
      input: [...safeHistory, { role: "user", content: input.trim() }]
    })
  });
  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) throw new Error("Georgie returned an empty response");
  return { text, responseId: payload.id };
}

export async function planActions(input, toolDefinitions = []) {
  if (!input?.trim() || !toolDefinitions.length) return [];
  try {
    const result = await jsonResponse({
      model: process.env.OPENAI_ROUTER_MODEL || process.env.OPENAI_MODEL || "gpt-5",
      instructions: `You are Georgie's action router. Decide whether the user's request needs any available tools. Return strict JSON only: {"actions":[{"tool":"tool.name","args":{}}]}. Use only tools listed below. Prefer no tool when the user is only asking for advice, explanation, conversation, or creative work. Use task tools when the user explicitly asks to create, list, complete, cancel, or update tasks/reminders. Use memory search only when durable personal context is necessary and not already supplied. Do not invent unavailable tools. Maximum 4 actions.\n\nAVAILABLE TOOLS\n${JSON.stringify(toolDefinitions)}`,
      input: input.trim()
    });
    return Array.isArray(result.actions)
      ? result.actions.filter((item) => item && typeof item.tool === "string").slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

export async function extractMemoryCandidates(userText, assistantText = "") {
  if (!userText?.trim()) return [];
  try {
    const parsed = await jsonResponse({
      model: process.env.OPENAI_MEMORY_MODEL || process.env.OPENAI_MODEL || "gpt-5",
      instructions: `Extract only durable information worth remembering for a personal assistant. Return strict JSON only: {"memories":[{"text":"...","category":"preference|identity|relationship|project|goal|routine|constraint|fact","importance":0.0,"tags":["..."]}]}. Remember stable preferences, identities, relationships, ongoing projects, goals, routines, constraints, and durable factual context. Do not store passwords, authentication secrets, API keys, one-time codes, financial account numbers, or other credentials. Do not save casual filler or short-lived details unless they clearly matter to an ongoing goal. Return at most 5 memories.`,
      input: `User: ${userText.trim()}\nAssistant: ${String(assistantText || "").slice(0, 4000)}`
    });
    if (!Array.isArray(parsed.memories)) return [];
    return parsed.memories.filter((item) => item && typeof item.text === "string" && item.text.trim()).slice(0, 5).map((item) => ({
      text: item.text.trim().slice(0, 2000),
      category: String(item.category || "fact").slice(0, 50),
      importance: Math.max(0, Math.min(1, Number(item.importance) || 0.5)),
      tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 12) : []
    }));
  } catch { return []; }
}

export async function transcribeAudio({ buffer, mimeType, filename }) {
  if (!buffer?.length) throw new Error("Audio is required");
  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  form.append("file", new Blob([buffer], { type: mimeType || "audio/webm" }), filename || "voice.webm");
  const response = await openAI("/audio/transcriptions", { method: "POST", body: form });
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
