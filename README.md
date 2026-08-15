# Georgie

Georgie is a sophisticated, voice-first personal AI assistant designed to respond quickly, reason across tasks, guide decisions, remember durable context, and coordinate tools and integrations through a modular architecture.

## Voice loop

```text
Browser microphone
   ↓
MediaRecorder audio capture
   ↓
OpenAI speech-to-text
   ↓
Georgie reasoning core
   ↓
Persistent identity + relevant memory retrieval
   ↓
OpenAI text-to-speech
   ↓
Spoken audio playback
```

The browser never receives the OpenAI API key. Audio, reasoning, memory extraction, and speech requests are handled by the Node server.

## Current capabilities

- Hold-to-talk microphone interaction
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
- Responsive voice interface

## Memory architecture

Georgie currently uses a pluggable local persistence layer stored under `GEORGIE_DATA_DIR` (default `data`). Runtime memory data is intentionally excluded from git.

The store contains three logical layers:

1. **Identity profile** — stable user attributes and preferences.
2. **Durable memory** — important facts, goals, relationships, routines, constraints, projects, and preferences.
3. **Session memory** — recent conversational turns for continuity.

Before each response, Georgie retrieves the most relevant durable memories using a relevance score combining lexical similarity, importance, and recency. The selected context is injected into Georgie's reasoning instructions. After the response, a separate memory pass identifies up to five new durable memories worth retaining.

The storage module is isolated so it can later be replaced by PostgreSQL/Supabase plus embeddings/vector search without changing the assistant interface.

## Run locally

Requirements: Node.js 20+ and an OpenAI API key.

```bash
npm install
cp .env.example .env
npm start
```

Set `OPENAI_API_KEY` in `.env`, then open `http://localhost:3000` in a browser and allow microphone access.

## Configuration

```env
OPENAI_API_KEY=...
PORT=3000
OPENAI_MODEL=gpt-5
OPENAI_MEMORY_MODEL=gpt-5
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_VOICE=cedar
GEORGIE_DATA_DIR=data
```

## API

Core:

- `GET /health` — service/configuration status
- `POST /api/transcribe` — audio → text
- `POST /api/respond` — text → memory-aware Georgie response
- `POST /api/speak` — text → speech audio
- `POST /api/voice-turn` — complete audio → transcript → memory-aware Georgie → spoken response pipeline

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
3. Wake-name / hands-free listening behavior
4. Tool and account integrations
5. Proactive tasks, alerts, and workflows
6. Premium multimodal interface and native-device experience
