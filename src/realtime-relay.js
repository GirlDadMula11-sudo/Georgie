import { WebSocketServer, WebSocket } from "ws";
import { askGeorgie } from "./georgie.js";
import { executeTool, listToolDefinitions } from "./tools.js";

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";

function requireApiKey() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  return process.env.OPENAI_API_KEY;
}

function safeReadToolDefinitions() {
  return listToolDefinitions()
    .filter((tool) => tool.risk === "read")
    .map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", additionalProperties: true }
    }));
}

function realtimeInstructions() {
  return `You are Georgie, Sierra's male chief of staff, technical architect, and operating intelligence. You are calm, controlled, precise, highly intelligent, and never frantic.

VOICE AND PRESENCE
- Present unmistakably as an adult male voice: low register, smooth resonance, restrained energy, measured cadence.
- Never sound feminine, bubbly, perky, sing-song, synthetic, theatrical, or like Siri/Alexa/a call-center bot.
- Speak like a private executive advisor in a quiet room: grounded, unhurried, confident, concise.
- Use downward statement cadence. Avoid upward inflection except for genuine questions.
- Keep vocal energy around 4/10. No breathless pacing, no exaggerated enthusiasm, no radio-announcer delivery.
- Use natural micro-pauses before decisions, figures, diagnoses, and next actions.
- Avoid canned acknowledgements such as “Absolutely!”, “Of course!”, “Great question!”, “Sure thing!”, or repeated use of the user's name.
- Do not chatter while thinking. If a request is complex, say one short grounded sentence, then do the work.
- Prefer short, decisive sentences in voice. Expand only when the user asks or complexity requires it.
- Your tone should feel like a highly capable male chief of staff who already understands the company, not a consumer assistant waiting for commands.

INTELLIGENCE AND OPERATIONS
Maintain continuity across the live conversation. Use Sierra/system tools whenever the user asks about current company state, deals, health, lender activity, offers, strategy, infrastructure, or connected systems. Never invent live facts. Distinguish verified observations from inference. For deep architecture, root-cause reasoning, strategic judgment, complex troubleshooting, or long-horizon technology recommendations, call georgie.deep_reason rather than improvising a shallow answer.

Safe reads are allowed automatically. Do not perform destructive changes, external communications, credential operations, legal commitments, or financial commitments in realtime voice. The user may interrupt at any time; stop speaking and listen. Never compete with the user for the floor.`;
}

function sessionUpdate() {
  const tools = [
    ...safeReadToolDefinitions(),
    {
      type: "function",
      name: "georgie.deep_reason",
      description: "Escalate complex architecture, root-cause diagnostics, strategy, underwriting analysis, technology direction, or high-impact decisions to Georgie's frontier reasoning engine.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          context: { type: "string" }
        },
        required: ["question"],
        additionalProperties: false
      }
    }
  ];

  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1",
      instructions: realtimeInstructions(),
      output_modalities: ["audio"],
      max_output_tokens: 1800,
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          noise_reduction: { type: "near_field" },
          transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-realtime-whisper", language: "en" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "low",
            create_response: true,
            interrupt_response: true
          }
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          voice: process.env.OPENAI_VOICE || "echo",
          speed: 0.90
        }
      },
      tools,
      tool_choice: "auto",
      truncation: { type: "retention_ratio", retention_ratio: 0.8 }
    }
  };
}

async function runFunctionCall({ name, arguments: rawArgs, call_id }, userId) {
  let args = {};
  try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { args = {}; }

  if (name === "georgie.deep_reason") {
    const question = String(args.question || "").trim();
    if (!question) return { ok: false, error: "question is required" };
    const context = String(args.context || "").slice(0, 12000);
    const result = await askGeorgie(question, [], context);
    return { ok: true, tool: name, result: { text: result.text, model: result.model } };
  }

  const def = listToolDefinitions().find((tool) => tool.name === name);
  if (!def) return { ok: false, error: `Unknown tool: ${name}` };
  if (def.risk !== "read") return { ok: false, error: "Realtime voice is read-only for governed safety" };
  return executeTool({ name, args, userId, policy: "read" });
}

export function attachRealtimeRelay(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

  server.on("upgrade", (request, socket, head) => {
    let pathname = "";
    try { pathname = new URL(request.url || "/", "https://georgie.local").pathname; } catch { pathname = ""; }
    if (pathname !== "/api/realtime") return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (client, request) => {
    const url = new URL(request.url || "/api/realtime", "https://georgie.local");
    const userId = String(url.searchParams.get("userId") || process.env.GEORGIE_PRIMARY_USER_ID || "primary").slice(0, 100);
    const upstream = new WebSocket(`${OPENAI_REALTIME_URL}?model=${encodeURIComponent(process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1")}`, {
      headers: { Authorization: `Bearer ${requireApiKey()}` }
    });

    let upstreamReady = false;
    const queued = [];

    const sendUpstream = (obj) => {
      const data = JSON.stringify(obj);
      if (upstreamReady && upstream.readyState === WebSocket.OPEN) upstream.send(data);
      else queued.push(data);
    };

    upstream.on("open", () => {
      upstreamReady = true;
      upstream.send(JSON.stringify(sessionUpdate()));
      for (const data of queued.splice(0)) upstream.send(data);
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "georgie.realtime.ready" }));
    });

    client.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "audio" && typeof msg.audio === "string") {
          sendUpstream({ type: "input_audio_buffer.append", audio: msg.audio });
        } else if (msg.type === "text" && typeof msg.text === "string") {
          sendUpstream({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: msg.text }] }
          });
          sendUpstream({ type: "response.create" });
        } else if (msg.type === "response.cancel") {
          sendUpstream({ type: "response.cancel" });
        } else if (msg.type === "audio.clear") {
          sendUpstream({ type: "input_audio_buffer.clear" });
        }
      } catch {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "georgie.error", error: "Invalid client realtime message" }));
      }
    });

    upstream.on("message", async (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }

      if (event.type === "response.function_call_arguments.done") {
        try {
          const result = await runFunctionCall(event, userId);
          sendUpstream({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(result).slice(0, 30000) }
          });
          sendUpstream({ type: "response.create" });
        } catch (error) {
          sendUpstream({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Tool failed" }) }
          });
          sendUpstream({ type: "response.create" });
        }
      }

      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
    });

    const closeBoth = () => {
      try { if (client.readyState === WebSocket.OPEN) client.close(); } catch {}
      try { if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(); } catch {}
    };

    client.on("close", closeBoth);
    client.on("error", closeBoth);
    upstream.on("close", () => { if (client.readyState === WebSocket.OPEN) client.close(); });
    upstream.on("error", (error) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "georgie.error", error: error?.message || "Realtime upstream failed" }));
      closeBoth();
    });
  });

  console.log("[Georgie] Persistent realtime relay attached at /api/realtime");
  return wss;
}
