import { runtimePolicy, shouldRunMemoryExtraction } from "./runtime-policy.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

const SYSTEM_PROMPT = `You are Georgie, Sierra's futuristic chief of staff, technical architect, and executive operating intelligence.
Your job is not merely to answer questions. Maintain a coherent picture of what the user is trying to accomplish, what Sierra is doing now, what is failing or changing, and what should happen next.
Operate at the level of an excellent chief of staff, systems architect, operator, and technology strategist.
Be fast, composed, highly competent, proactive, practical, evidence-driven, and resourceful.

OPERATING STANDARD
- Lead with the answer, decision, diagnosis, or next move. Do not make the user drag conclusions out of you.
- Use deterministic facts and live system evidence before speculation. Distinguish verified observations, inferences, forecasts, recommendations, and completed actions.
- For Sierra operational questions, reason across the whole chain when evidence is available: intake -> documents -> underwriting -> CapitalMatch -> lender delivery -> lender response -> closing/funding -> CRM/accounting evidence, plus auth, database, queues, workers, deployments, integrations, and infrastructure.
- Detect contradictions and missing evidence instead of smoothing them over. Never fabricate lender guidelines, underwriting facts, financial data, communications, approvals, system health, or tool results.
- Prefer root-cause explanations and ranked next actions over generic troubleshooting lists.
- When multiple independent facts are needed, synthesize them together rather than narrating each lookup.
- Treat cost and latency as architecture constraints. Prefer deterministic logic, cached/current state, event-driven evidence, and inexpensive models for routine work; spend frontier reasoning only when complexity or business impact justifies it.
- Preserve control. Safe reads and bounded reversible maintenance may proceed under configured policy; consequential external communication, destructive changes, credentials, legal commitments, and material financial actions remain governed.

FUTURE & TECHNOLOGY RADAR
- Keep Sierra pointed toward the technology curve rather than copying yesterday's software patterns.
- When the user asks about technology direction, architecture, AI, automation, future capabilities, competitive advantage, or what should come next, evaluate the current technology climate with live research when useful.
- Separate durable trends from hype. Consider agentic systems, realtime multimodal interfaces, event-driven architecture, model routing, local/on-device intelligence, secure tool use, observability, durable memory, data quality, autonomous operations, human approval boundaries, cost curves, and vendor lock-in.
- Translate technology trends into concrete Sierra advantages: faster deal processing, better lender intelligence, stronger conversion, lower operating cost, higher reliability, better evidence, and less manual work.
- Recommend the smallest architecture that creates durable leverage. Avoid adding fashionable components without a measurable reason.

CONVERSATION & VOICE
- Sound like a sophisticated executive partner, not a help-desk bot.
- For spoken interactions, use concise natural sentences first. Give deeper detail only when needed or requested.
- Maintain conversational continuity and understand follow-ups from recent context instead of treating every turn as a fresh session.
- If work will take multiple stages, state the immediate finding or action first, then continue the deeper analysis.

Use provided memory, identity, task, mail, Sierra, and tool context naturally when relevant. Treat memories as context that may become outdated; current user statements and live evidence outrank old memory.
Use live web research when current, niche, changing, competitive, or externally verifiable information would materially improve accuracy.
When a connector or authorization is unavailable, state that precisely and continue everything else that can safely proceed.`;

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

function chooseReasoningModel(policy) {
  if (policy.reasoningEffort === "high") return process.env.OPENAI_MODEL || "gpt-5.6-sol";
  if (policy.reasoningEffort === "medium") return process.env.OPENAI_BALANCED_MODEL || "gpt-5.6-terra";
  return process.env.OPENAI_FAST_MODEL || "gpt-5.6-luna";
}

export async function askGeorgie(input, history = [], context = "") {
  if (!input?.trim()) throw new Error("Input is required");
  const fast=fastMacAction(input);
  if(fast){return {text:`Command sent to your Mac: ${fast[0].args.app}.`,responseId:null,webSearches:0,model:"deterministic-fast-path"};}
  const policy = runtimePolicy(input);
  const safeHistory = Array.isArray(history) ? history.slice(-12).filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string") : [];
  const instructions = context ? `${SYSTEM_PROMPT}\n\nCURRENT OPERATING CONTEXT\n${context}` : SYSTEM_PROMPT;
  const model = chooseReasoningModel(policy);
  const body = { model, instructions, input: [...safeHistory, { role: "user", content: input.trim() }], reasoning: reasoning(process.env.OPENAI_REASONING_EFFORT || policy.reasoningEffort), text: { verbosity: process.env.OPENAI_VERBOSITY || policy.responseVerbosity } };
  if (process.env.GEORGIE_WEB_ENABLED !== "false" && policy.allowWebTool) body.tools = [{ type: "web_search" }];
  const response = await openAI("/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json(); const text = extractResponseText(payload); if (!text) throw new Error("Georgie returned an empty response");
  return { text, responseId: payload.id, webSearches: (payload.output || []).filter((item) => item.type === "web_search_call").length, model: body.model };
}

export async function planActions(input, toolDefinitions = []) {
  if (!input?.trim() || !toolDefinitions.length) return [];
  const fast=fastMacAction(input); if(fast)return fast;
  const policy = runtimePolicy(input);
  if (!policy.needsToolRouter) return [];
  try {
    const result = await jsonResponse({ model: process.env.OPENAI_ROUTER_MODEL || "gpt-5.6-luna", effort: process.env.OPENAI_ROUTER_REASONING_EFFORT || "low", instructions: `You are Georgie's action router. Decide whether the user's request needs available tools. Return strict JSON only: {"actions":[{"tool":"tool.name","args":{}}]}. Use only listed tools. Prefer no tool for advice, explanation, conversation, or creative work. Use actual data tools when the user needs current account or business information; never invent results. Use task tools for explicit task/reminder changes. Use memory search only when durable context is necessary and absent. Do not invent unavailable tools. Maximum 6 actions. Prefer independent safe reads in parallel. Do not perform destructive, financial, legal-commitment, credential, or externally consequential writes without the system's required approval gate.\n\nAVAILABLE TOOLS\n${JSON.stringify(toolDefinitions)}`, input: input.trim() });
    return Array.isArray(result.actions) ? result.actions.filter((item) => item && typeof item.tool === "string").slice(0, 6) : [];
  } catch { return []; }
}

export async function analyzeOperationalEmail(message) { try { return await jsonResponse({ model: process.env.OPENAI_ROUTER_MODEL || "gpt-5.6-luna", effort: "low", instructions: `You are Georgie's executive email triage engine. Return strict JSON only with: {"priority":"low|normal|high|urgent","category":"client|lender|partner|finance|legal|operations|personal|marketing|other","summary":"...","requiresAction":true,"action":"...","dueAt":null,"suggestedReply":"...","confidence":0.0}. Be conservative about urgency. Treat explicit deadlines, funding decisions, approvals, client/lender blockers, legal notices, payment issues, security alerts, and time-sensitive family matters as potentially high priority. Do not invent facts. Suggested replies must be concise, professional, and based only on the message.`, input: JSON.stringify({ subject: message?.subject || "", from: message?.from || "", to: message?.to || "", date: message?.date || null, text: String(message?.text || "").slice(0, 16000) }) }); } catch { return { priority: "normal", category: "other", summary: "Email received", requiresAction: false, action: "", dueAt: null, suggestedReply: "", confidence: 0 }; } }
export async function extractMemoryCandidates(userText, assistantText = "") { if (!userText?.trim() || !shouldRunMemoryExtraction(userText, assistantText)) return []; try { const parsed = await jsonResponse({ model: process.env.OPENAI_MEMORY_MODEL || "gpt-5.6-luna", effort: "low", instructions: `Extract only durable information worth remembering for a personal assistant. Return strict JSON only: {"memories":[{"text":"...","category":"preference|identity|relationship|project|goal|routine|constraint|fact","importance":0.0,"tags":["..."]}]}. Remember stable preferences, identities, relationships, ongoing projects, goals, routines, constraints, and durable factual context. Do not store passwords, authentication secrets, API keys, one-time codes, financial account numbers, or other credentials. Do not save casual filler or short-lived details unless they clearly matter to an ongoing goal. Return at most 5 memories.`, input: `User: ${userText.trim()}\nAssistant: ${String(assistantText || "").slice(0, 4000)}` }); if (!Array.isArray(parsed.memories)) return []; return parsed.memories.filter((item) => item && typeof item.text === "string" && item.text.trim()).slice(0, 5).map((item) => ({ text: item.text.trim().slice(0, 2000), category: String(item.category || "fact").slice(0, 50), importance: Math.max(0, Math.min(1, Number(item.importance) || 0.5)), tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 12) : [] })); } catch { return []; } }
export async function transcribeAudio({ buffer, mimeType, filename }) { if (!buffer?.length) throw new Error("Audio is required"); const form = new FormData(); form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-realtime-whisper"); form.append("file", new Blob([buffer], { type: mimeType || "audio/webm" }), filename || "voice.webm"); const response = await openAI("/audio/transcriptions", { method: "POST", body: form }); const payload = await response.json(); if (!payload.text?.trim()) throw new Error("No speech was detected"); return payload.text.trim(); }
export async function synthesizeSpeech(text) { if (!text?.trim()) throw new Error("Text is required for speech synthesis"); const response = await openAI("/audio/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: process.env.OPENAI_VOICE || "cedar", input: text.slice(0, 4096), response_format: "mp3", instructions: "Adult male executive voice. Low, smooth, refined register; composed and confident, never robotic or announcer-like. Speak with natural conversational rhythm, crisp diction, subtle warmth, and intelligent restraint. Move briskly without sounding rushed. Use short pauses around decisions and numbers. Sound like a futuristic chief of staff speaking privately to an executive." }) }); return Buffer.from(await response.arrayBuffer()); }
