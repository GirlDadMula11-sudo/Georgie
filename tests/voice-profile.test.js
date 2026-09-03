import test from "node:test";
import assert from "node:assert/strict";
import { GEORGIE_PRESENCE_STATES, GEORGIE_VOICE_PROFILE, chooseGeorgieVoice } from "../public/voice-profile.js";
import { parseWakeTranscript } from "../public/handsfree.js";

test("Georgie owns a stable feminine command voice profile", () => {
  assert.equal(GEORGIE_VOICE_PROFILE.presentation, "feminine");
  assert.equal(GEORGIE_VOICE_PROFILE.locale, "en-US");
  assert.ok(GEORGIE_VOICE_PROFILE.preferredVoiceNames.length >= 4);
});

test("voice selection is deterministic and never prefers a named male fallback", () => {
  const voices = [
    { name: "Daniel", lang: "en-US" },
    { name: "Samantha", lang: "en-US" },
    { name: "Ava", lang: "en-US" }
  ];
  assert.equal(chooseGeorgieVoice(voices)?.name, "Samantha");
});

test("presence contract covers conversation, execution, governance and recovery states", () => {
  for (const state of ["standby", "awake", "listening", "thinking", "speaking", "working", "approval_needed", "completed", "blocked"])
    assert.ok(GEORGIE_PRESENCE_STATES.includes(state), `missing ${state}`);
});

test("wake parsing accepts natural Georgie invocations and preserves the command", () => {
  assert.deepEqual(parseWakeTranscript("Hey Georgie, check Capital Match."), {
    woke: true,
    command: "check Capital Match.",
    transcript: "Hey Georgie, check Capital Match.",
    wakeName: "hey georgie"
  });
  assert.equal(parseWakeTranscript("the meeting starts at ten").woke, false);
});
