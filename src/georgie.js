const OPENAI_BASE_URL = "https://api.openai.com/v1";

const SYSTEM_PROMPT = `You are Georgie, a sophisticated personal AI assistant and executive operating system.
Your role is to work alongside the user as an intelligent chief of staff: understand the real objective, reduce workload, coordinate tools and business systems, surface important risks and opportunities, and keep work moving.
Be fast, calm, capable, proactive, practical, evidence-driven, and resourceful.
Use provided memory, identity, task, mail, Sierra, and tool context naturally when relevant, but do not force it into unrelated answers.
Treat memories as context that may become outdated. If a current user statement conflicts with older memory, prefer the current statement.
Use live web research when current, niche, changing, or externally verifiable information would materially improve accuracy.
Distinguish verified facts, system observations, inferences, recommendations, and completed actions. Never claim an action succeeded unless the system confirms it.
Never fabricate lender guidelines, underwriting facts, financial data, communications, approvals, or tool results.
For consequential financial or operational decisions, favor evidence quality and explicit uncertainty over speed. For routine low-risk work, favor speed and completion.
When an action requires approval or a connector is unavailable, state that clearly and continue everything else that can safely proceed.
Prefer concise spoken answers, but be thorough when complexity, risk, or a decision requires it.`;

const FAST_APPS = ["Safari","Google Chrome","Notes","Mail","Finder","Calendar","Messages","Preview","System Settings","Microsoft Excel","Microsoft Word","Adobe Acrobat Reader"];
function canonicalFastApp(value){const q=String(value||"").trim().toLowerCase();return FAST_APPS.find(app=>app.toLowerCase()===q)||null;}
function fastMacAction(input){
  const text=String(input||"").trim();
  const match=text.match(/^(?:please\s+)?(?:open|launch|start)\s+(.+?)[.!]?$/i);
  if(match){const app=canonicalFastApp(match[1]);if(app)return [{tool:"mac.open_app",args:{app}}];}
  const activate=text.match(/^(?:please\s+)?(?:switch to|activate|bring up)\s+(.+?)[.!]?$/i);
  if(activate){const app=canonicalFastApp(activate[1]);if(app)return [{tool:"mac.activate_app",args:{app}}];}
  return null;
}

function requireApiKey() { if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured"); return process.env.OPENAI_API_KEY; }
async function openAI(path, options = {}) { const response = await fetch(`${OPENAI_BASE_URL}${path}`, { ...options, headers: { Authorization: `Bearer ${requireApiKey()}`, ...(options.headers || {}) } }); if (!response.ok) { const body = await response.text(); throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 500)}`); } return response; }
function extractResponseText(payload) { if (payload.output_text) return payload.output_text; for (const item of payload.output || []) for (const content of item.content || []) if (content.type === "output_text" && content.text) return content.text; return ""; }
function reasoning(effort = "medium") { return { effort, context: "all_turns" }; }
async function jsonResponse({ model, instructions, input, effort = "medium" }) { const response = await openAI("/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, instructions, input, reasoning: reasoning(effort), text: { verbosity: "low" } }) }); const payload = await response.json(); const raw = extractResponseText(payload).trim(); return JSON.parse(raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()); }

export async function askGeorgie(input, history = [], context = "") {
  if (!input?.trim()) throw new Error("Input is required");
  const fast=fastMacAction(input);
  if(fast){return {text:`Command sent to your Mac: ${fast[0].args.app}.`,responseId:null,webSearches:0,model:"deterministic-fast-path"};}
  const safeHistory = Array.isArray(history) ? history.slice(-24).filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string") : [];
  const instructions = context ? `${SYSTEM_PROMPT}\n\nCURRENT CONTEXT\n${context}` : SYSTEM_PROMPT;
  const body = { model: process.env.OPENAI_MODEL || "gpt-5.6", instructions, input: [...safeHistory, { role: "user", content: input.trim() }], reasoning: reasoning(process.env.OPENAI_REASONING_EFFORT || "medium"), text: { verbosity: process.env.OPENAI_VERBOSITY || "medium" } };
  if (process.env.GEORGIE_WEB_ENABLED !== "false") body.tools = [{ type: "web_search" }];
  const response = await openAI("/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json(); const text = extractResponseText(payload); if (!text) throw new Error("Georgie returned an empty response");
  return { text, responseId: payload.id, webSearches: (payload.output || []).filter((item) => item.type === "web_search_call").length, model: body.model };
}

export async function planActions(input, toolDefinitions = []) {
  if (!input?.trim() || !toolDefinitions.length) return [];
  const fast=fastMacAction(input); if(fast)return fast;
  try {
    const result = await jsonResponse({ model: process.env.OPENAI_ROUTER_MODEL || "gpt-5.6-terra", effort: process.env.OPENAI_ROUTER_REASONING_EFFORT || "low", instructions: `You are Georgie's action router. Decide whether the user's request needs available tools. Return strict JSON only: {"actions":[{"tool":"tool.name","args":{}}]}. Use only listed tools. Prefer no tool for advice, explanation, conversation, or creative work. Use actual data tools when the user needs current account or business information; never invent results. Use task tools for explicit task/reminder changes. Use memory search only when durable context is necessary and absent. Do not invent unavailable tools. Maximum 6 actions. Prefer independent safe reads in parallel. Do not perform destructive, financial, legal-commitment, credential, or externally consequential writes without the system's required approval gate.\n\nAVAILABLE TOOLS\n${JSON.stringify(toolDefinitions)}`, input: input.trim() });
    return Array.isArray(result.actions) ? result.actions.filter((item) => item && typeof item.tool === "string").slice(0, 6) : [];
  } catch { return []; }
}

export async function analyzeOperationalEmail(message) { try { return await jsonResponse({ model: process.env.OPENAI_ROUTER_MODEL || "gpt-5.6-terra", effort: "low", instructions: `You are Georgie's executive email triage engine. Return strict JSON only with: {"priority":"low|normal|high|urgent","category":"client|lender|partner|finance|legal|operations|personal|marketing|other","summary":"...","requiresAction":true,"action":"...","dueAt":null,"suggestedReply":"...","confidence":0.0}. Be conservative about urgency. Treat explicit deadlines, funding decisions, approvals, client/lender blockers, legal notices, payment issues, security alerts, and time-sensitive family matters as potentially high priority. Do not invent facts. Suggested replies must be concise, professional, and based only on the message.`, input: JSON.stringify({ subject: message?.subject || "", from: message?.from || "", to: message?.to || "", date: message?.date || null, text: String(message?.text || "").slice(0, 16000) }) }); } catch { return { priority: "normal", category: "other", summary: "Email received", requiresAction: false, action: "", dueAt: null, suggestedReply: "", confidence: 0 }; } }
export async function extractMemoryCandidates(userText, assistantText = "") { if (!userText?.trim()) return []; try { const parsed = await jsonResponse({ model: process.env.OPENAI_MEMORY_MODEL || "gpt-5.6-luna", effort: "low", instructions: `Extract only durable information worth remembering for a personal assistant. Return strict JSON only: {"memories":[{"text":"...","category":"preference|identity|relationship|project|goal|routine|constraint|fact","importance":0.0,"tags":["..."]}]}. Remember stable preferences, identities, relationships, ongoing projects, goals, routines, constraints, and durable factual context. Do not store passwords, authentication secrets, API keys, one-time codes, financial account numbers, or other credentials. Do not save casual filler or short-lived details unless they clearly matter to an ongoing goal. Return at most 5 memories.`, input: `User: ${userText.trim()}\nAssistant: ${String(assistantText || "").slice(0, 4000)}` }); if (!Array.isArray(parsed.memories)) return []; return parsed.memories.filter((item) => item && typeof item.text === "string" && item.text.trim()).slice(0, 5).map((item) => ({ text: item.text.trim().slice(0, 2000), category: String(item.category || "fact").slice(0, 50), importance: Math.max(0, Math.min(1, Number(item.importance) || 0.5)), tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 12) : [] })); } catch { return []; } }
export async function transcribeAudio({ buffer, mimeType, filename }) { if (!buffer?.length) throw new Error("Audio is required"); const form = new FormData(); form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"); form.append("file", new Blob([buffer], { type: mimeType || "audio/webm" }), filename || "voice.webm"); const response = await openAI("/audio/transcriptions", { method: "POST", body: form }); const payload = await response.json(); if (!payload.text?.trim()) throw new Error("No speech was detected"); return payload.text.trim(); }
export async function synthesizeSpeech(text) { if (!text?.trim()) throw new Error("Text is required for speech synthesis"); const response = await openAI("/audio/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: process.env.OPENAI_VOICE || "cedar", input: text.slice(0, 4096), response_format: "mp3", instructions: "Speak naturally, confidently, warmly, and efficiently. Sound like a highly capable executive and personal assistant." }) }); return Buffer.from(await response.arrayBuffer()); }
