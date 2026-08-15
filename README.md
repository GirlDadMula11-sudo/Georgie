# Georgie

Georgie is a sophisticated, voice-first personal AI assistant designed to respond quickly, reason across tasks, guide decisions, and coordinate tools and integrations through a modular architecture.

## Voice loop

The first end-to-end voice layer is now implemented:

```text
Browser microphone
   ↓
MediaRecorder audio capture
   ↓
OpenAI speech-to-text
   ↓
Georgie reasoning core
   ↓
OpenAI text-to-speech
   ↓
Spoken audio playback
```

The browser never receives the OpenAI API key. Audio and reasoning requests are handled by the Node server.

## Current capabilities

- Hold-to-talk microphone interaction
- Mobile-friendly browser recording, including iOS-compatible MIME fallback
- Speech transcription with `gpt-4o-mini-transcribe`
- Georgie reasoning through the Responses API
- Spoken responses with `gpt-4o-mini-tts`
- Default `cedar` voice
- Typed-chat fallback
- Short conversation history passed between turns
- Secure server-side API credentials
- Health/configuration endpoint
- Responsive voice interface

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
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_VOICE=cedar
```

## API

- `GET /health` — service/configuration status
- `POST /api/transcribe` — audio → text
- `POST /api/respond` — text → Georgie response
- `POST /api/speak` — text → speech audio
- `POST /api/voice-turn` — complete audio → transcript → Georgie → spoken response pipeline

## Roadmap

1. Persistent memory and session identity
2. Wake-name / hands-free listening behavior
3. Tool and account integrations
4. Proactive tasks, alerts, and workflows
5. Premium multimodal interface and native-device experience
