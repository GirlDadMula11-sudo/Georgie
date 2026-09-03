export const GEORGIE_VOICE_PROFILE = Object.freeze({
  id: "georgie-command-v1",
  locale: "en-US",
  presentation: "feminine",
  rate: 1.02,
  pitch: 1.04,
  volume: 1,
  preferredVoiceNames: Object.freeze([
    "Samantha",
    "Ava",
    "Allison",
    "Susan",
    "Zoe",
    "Siri Female"
  ])
});

export const GEORGIE_PRESENCE_STATES = Object.freeze([
  "off",
  "calibrating",
  "standby",
  "hearing",
  "awake",
  "listening",
  "thinking",
  "speaking",
  "working",
  "approval_needed",
  "completed",
  "blocked",
  "paused"
]);

export function chooseGeorgieVoice(voices = [], profile = GEORGIE_VOICE_PROFILE) {
  const english = voices.filter((voice) => /^en(?:-|_)/i.test(String(voice?.lang || "")));
  for (const preferred of profile.preferredVoiceNames) {
    const exact = english.find((voice) => String(voice?.name || "").toLowerCase() === preferred.toLowerCase());
    if (exact) return exact;
  }
  return english.find((voice) => /female|woman|samantha|ava|allison|susan|zoe/i.test(String(voice?.name || "")))
    || english.find((voice) => /^en-US/i.test(String(voice?.lang || "")))
    || english[0]
    || null;
}
