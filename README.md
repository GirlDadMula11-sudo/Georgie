# Georgie

Georgie is a sophisticated, voice-first personal AI assistant designed to respond quickly, reason across tasks, remember durable context, wake by name, hold natural follow-up conversations, and coordinate tools and integrations through a modular architecture.

## Voice architecture

```text
Ambient microphone
   ↓
Adaptive room-noise calibration + voice activity detection
   ↓
Wake-name recognition: “Georgie”
   ↓
Active conversational window
   ↓
OpenAI speech-to-text
   ↓
Persistent identity + relevant memory retrieval
   ↓
Georgie reasoning core
   ↓
OpenAI text-to-speech
   ↓
Spoken response
   ↓
Follow-up listening / barge-in / standby
```

The browser never receives the OpenAI API key. Audio, reasoning, memory extraction, and speech requests are handled by the Node server.

## Current capabilities

- Hands-free wake-name mode using “Georgie”, “Hey Georgie”, “Okay Georgie”, or “OK Georgie”
- Adaptive voice-activity detection with room-noise calibration
- Silence-based utterance segmentation instead of fixed recording timers
- Wake-only activation: saying only “Georgie” opens a conversational window
- Wake + command in a single phrase, such as “Georgie, what’s on my schedule?”
- 14-second contextual follow-up window so the wake name does not need to be repeated every turn
- Natural standby commands including “never mind”, “go to sleep”, “stand by”, and “that’s all”
- Barge-in support so the user can interrupt Georgie while he is speaking
- Stronger barge-in threshold during playback to reduce self-triggering from Georgie’s own voice
- Echo cancellation, noise suppression, and automatic gain-control requests
- Automatic pause when the page is backgrounded and safe resume when foregrounded
- Manual hold-to-talk fallback
- Mobile-friendly browser recording, including iOS-compatible MIME fallback
- Speech transcription
- Georgie reasoning through the Responses API
- Spoken responses
- Typed-chat fallback
- Durable per-user identity
- Persistent session history across page reloads
- Automatic extraction of durable memories from conversations
- Relevance-ranked memory retrieval before each Georgie response
- Explicit memory create/list/search/delete APIs
- User profile read/update API
- Automatic duplicate-memory suppression
- Atomic runtime memory writes
- Safety rule preventing credential/API-key memories from being intentionally extracted
- Secure server-side API credentials
- Health/configuration endpoint
- Responsive voice-state interface

## Hands-free state machine

Georgie’s browser client runs a dedicated hands-free engine with these states:

`off → calibrating → standby → hearing → active/listening → speaking → standby`

During standby, local audio energy is analyzed continuously. Audio is not sent merely because the microphone is open; an utterance is captured only after sustained voice activity crosses the adaptive threshold. In standby, captured speech is transcribed to determine whether the wake name was spoken. Once awake, subsequent speech inside the follow-up window is treated as conversational input without requiring the name again.

If the user speaks loudly and continuously while Georgie is talking, the barge-in detector stops playback and immediately returns Georgie to active listening.

### Browser limitation

This browser implementation is designed for an open, foreground page. Mobile operating systems—especially iOS—may suspend microphone processing when the browser is locked or backgrounded. A later native-device layer can provide stronger OS-level always-available wake behavior.

## Memory architecture

Georgie currently uses a pluggable local persistence layer stored under `GEORGIE_DATA_DIR` (default `data`). Runtime memory data is intentionally excluded from git.

The store contains three logical layers:

1. **Identity profile** — stable user attributes and preferences.
2. **Durable memory** — important facts, goals, relationships, routines, constraints, projects, and preferences.
3. **Session memory** — recent conversational turns for continuity.

Before each response, Georgie retrieves the most relevant durable memories using a relevance score combining lexical similarity, importance, and recency. The selected context is injected into Georgie's reasoning instructions. After the response, a separate memory pass identifies new durable memories worth retaining.

The storage module is isolated so it can later be replaced by PostgreSQL/Supabase plus embeddings/vector search without changing the assistant interface.

## Run locally

Requirements: Node.js 20+ and an OpenAI API key.

```bash
npm install
cp .env.example .env
npm start
```

Set `OPENAI_API_KEY` in `.env`, open `http://localhost:3000`, allow microphone access, then enable **Hands-free mode** and say “Georgie”.

## API

Core:

- `GET /health` — service/configuration and capability status
- `POST /api/transcribe` — audio → text
- `POST /api/respond` — text → memory-aware Georgie response
- `POST /api/speak` — text → speech audio
- `POST /api/voice-turn` — complete manual audio → transcript → memory-aware Georgie → spoken response pipeline

Memory and identity:

- `GET /api/profile` — retrieve identity profile
- `PATCH /api/profile` — update identity profile
- `GET /api/memories` — list memories; add `?q=` for relevance search
- `POST /api/memories` — explicitly save a memory
- `DELETE /api/memories/:id` — forget one memory
- `GET /api/session` — restore recent session history

Clients identify themselves with `X-Georgie-User` and `X-Georgie-Session`. The browser client creates durable IDs in local storage and automatically restores its recent conversation.

## Roadmap

1. ✅ Voice interaction layer
2. ✅ Persistent memory and session identity
3. ✅ Wake-name / hands-free conversational behavior
4. Tool and account integrations
5. Proactive tasks, alerts, and workflows
6. Premium multimodal interface and native-device experience
