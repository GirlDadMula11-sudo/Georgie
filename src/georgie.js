const OPENAI_BASE_URL = "https://api.openai.com/v1";

const SYSTEM_PROMPT = `You are Georgie, a sophisticated personal AI assistant operating system.
You are fast, calm, capable, proactive, highly practical, and deeply resourceful.
Your job is to understand the user's real goal, reason carefully, reduce their workload, anticipate useful next steps, and use connected capabilities when they materially improve the outcome.
Use provided memory, identity, task, mail, and tool context naturally when relevant, but do not force it into unrelated answers.
Treat memories as context that may become outdated. If a current user statement conflicts with an older memory, prefer the current statement.
Use live web research when current, niche, changing, or externally verifiable information would improve accuracy.
Distinguish facts, inferences, recommendations, and completed actions. Never claim an action succeeded unless the system confirms it.
When an action requires approval or a connector is unavailable, state that clearly and continue helping with what is available.
Prefer concise spoken answers, but be thorough when complexity, risk, or a decision requires it.`;

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
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-5",
    instructions,
    input: [...safeHistory, { role: "user", content: input.trim() }]
  };
  if (process.env.GEORGIE_WEB_ENABLED !== "false") {
    body.tools = [{ type: "web_search" }];
  }
  const response = await openAI("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) throw new Error("Georgie returned an empty response");
  const webSearches = (payload.output || []).filter((item) => item.type === "web_search_call").length;
  return { text, responseId: payload.id, webSearches };
}

export async function planActions(input, toolDefinitions = []) {
  if (!input?.trim() || !toolDefinitions.length) return [];
  try {
    const result = await jsonResponse({
      model: process.env.OPENAI_ROUTER_MODEL || process.env.OPENAI_MODEL || "gpt-5",
      instructions: `You are Georgie's action router. Decide whether the user's request needs any available tools. Return strict JSON only: {"actions":[{"tool":"tool.name","args":{}}]}. Use only tools listed below. Prefer no tool when the user is only asking for advice, explanation, conversation, or creative work. Use email tools when the user needs actual mailbox information; never invent mailbox contents. Use task tools when the user explicitly asks to create, list, complete, cancel, or update tasks/reminders. Use memory search only when durable personal context is necessary and not already supplied. Do not invent unavailable tools. Maximum 4 actions.\n\nAVAILABLE TOOLS\n${JSON.stringify(toolDefinitions)}`,
      input: input.trim()
    });
    return Array.isArray(result.actions)
      ? result.actions.filter((item) => item && typeof item.tool === "string").slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

export async function analyzeOperationalEmail(message) {
  try {
    return await jsonResponse({
      model: process.env.OPENAI_ROUTER_MODEL || process.env.OPENAI_MODEL || "gpt-5",
      instructions: `You are Georgie's executive email triage engine. Return strict JSON only with: {"priority":"low|normal|high|urgent","category":"client|lender|partner|finance|legal|operations|personal|marketing|other","summary":"...","requiresAction":true,"action":"...","dueAt":null,"suggestedReply":"...","confidence":0.0}. Be conservative about urgency. Treat explicit deadlines, funding decisions, approvals, client/lender blockers, legal notices, payment issues, security alerts, and time-sensitive family matters as potentially high priority. Do not invent facts. Suggested replies must be concise, professional, and based only on the message.`,
      input: JSON.stringify({
        subject: message?.subject || "",
        from: message?.from || "",
        to: message?.to || "",
        date: message?.date || null,
        text: String(message?.text || "").slice(0, 16000)
      })
    });
  } catch {
    return { priority: "normal", category: "other", summary: "Email received", requiresAction: false, action: "", dueAt: null, suggestedReply: "", confidence: 0 };
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
      instructions: "Speak naturally, confidently, warmly, and efficiently. Sound like a highly capable executive and personal assistant."
    })
  });
  return Buffer.from(await response.arrayBuffer());
}
