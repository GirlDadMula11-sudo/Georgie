import { HandsFreeEngine, parseWakeTranscript } from "./handsfree.js";
import { authHeaders, georgieDeviceReady } from "./device-auth.js";

const voiceButton = document.querySelector("#voiceButton");
const voiceLabel = document.querySelector("#voiceLabel");
const statusEl = document.querySelector("#status");
const conversationEl = document.querySelector("#conversation");
const textForm = document.querySelector("#textForm");
const textInput = document.querySelector("#textInput");
const handsFreeToggle = document.querySelector("#handsFreeToggle");
const presenceState = document.querySelector("#presenceState");
const voiceOutputToggle = document.querySelector("#voiceOutputToggle");
const voiceOutputState = document.querySelector("#voiceOutputState");
const continuityState = document.querySelector("#continuityState");

let mediaRecorder;
let mediaStream;
let chunks = [];
let history = [];
let activeAudio;
let activeAudioUrl;
let isBusy = false;
let handsFreeBusy = false;
let manualSuspendedHandsFree = false;
let voiceOutputEnabled = localStorage.getItem("georgie:voiceOutput") !== "off";

const userId = "primary";
const sessionId = localStorage.getItem("georgie:sessionId") || crypto.randomUUID();
localStorage.setItem("georgie:userId", userId);
localStorage.setItem("georgie:sessionId", sessionId);

function requestHeaders(extra = {}) {
  return authHeaders({"X-Georgie-User":userId,"X-Georgie-Session":sessionId,...extra});
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setPresence(state, label) {
  document.body.dataset.voiceState = state;
  presenceState.textContent = label;
}

function appendMessage(role, text) {
  const item = document.createElement("article");
  item.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "Georgie";
  const body = document.createElement("p");
  body.textContent = text;
  item.append(label, body);
  if (role === "assistant") {
    const copy = document.createElement("button");
    copy.className = "copy-response";
    copy.type = "button";
    copy.textContent = "Copy full response";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(body.textContent || text);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy full response"; }, 1400);
    });
    item.append(copy);
  }
  conversationEl.append(item);
  item.scrollIntoView({ behavior: "smooth", block: "end" });
  return item;
}

function updateMessage(item, text) {
  const body = item?.querySelector("p");
  if (body) body.textContent = text;
}

function outcomeDomain(input, payload) {
  if (payload?.route?.domain === "sierra") return "sierra";
  if (payload?.route?.domain === "personal") return "personal";
  if (/\b(research|latest|source|evidence|find out)\b/i.test(input)) return "research";
  if (/\b(write|creative|concept|story|song|design)\b/i.test(input)) return "creative";
  if (Array.isArray(payload?.actions) && payload.actions.length) return "execution";
  return "general";
}

function attachOutcomeFeedback(item, input, payload) {
  const controls=document.createElement("div");controls.className="outcome-feedback";
  for(const [label,useful] of [["Helpful",true],["Needs work",false]]){const button=document.createElement("button");button.type="button";button.textContent=label;button.addEventListener("click",async()=>{for(const child of controls.children)child.disabled=true;await fetch("/api/mobile/feedback",{method:"POST",headers:requestHeaders({"Content-Type":"application/json"}),body:JSON.stringify({responseId:payload.responseId,domain:outcomeDomain(input,payload),useful})});button.textContent=useful?"Helpful ✓":"Recorded ✓";});controls.append(button);}
  item.append(controls);
}

function pushHistory(role, content) {
  history.push({ role, content });
  history = history.slice(-200);
}

async function restoreSession() {
  try {
    await georgieDeviceReady;
    const response = await fetch("/api/mobile/session?limit=200&scope=continuous", { headers: requestHeaders() });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !Array.isArray(payload.history)) return;
    history = payload.history.slice(-200);
    for (const turn of history) {
      if (["user", "assistant"].includes(turn.role) && turn.content) appendMessage(turn.role, turn.content);
    }
    if (continuityState) continuityState.textContent = history.length ? `${history.length} recent turns available` : "Conversation ready";
    if (history.length) setStatus("Full conversation restored. Ready when you are.");
  } catch (error) {
    console.warn("Session restore unavailable", error);
  }
}

function chooseMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function stopActiveAudio({ interrupted = false } = {}) {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.currentTime = 0;
  activeAudio = null;
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = null;
  handsFree.setAssistantSpeaking(false);
  if (interrupted) setStatus("I’m listening — go ahead.");
}

async function playWakeChime() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  await context.resume();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.08);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.13);
  setTimeout(() => context.close().catch(() => {}), 220);
}

async function playAudioBlob(blob) {
  stopActiveAudio();
  activeAudioUrl = URL.createObjectURL(blob);
  activeAudio = new Audio(activeAudioUrl);
  handsFree.setAssistantSpeaking(true);

  activeAudio.addEventListener("ended", () => {
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
    activeAudio = null;
    handsFree.setAssistantSpeaking(false);
    if (handsFree.enabled) {
      handsFree.activateFollowUp();
      setStatus("I’m still listening for a follow-up.");
    } else {
      setStatus("Ready when you are.");
    }
  }, { once: true });

  await activeAudio.play();
}

async function speak(text) {
  if (!voiceOutputEnabled) return;
  const response = await fetch("/api/mobile/speak", {
    method: "POST",
    headers: requestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text })
  });
  if (!response.ok) return browserVoiceFallback(text);
  try { await playAudioBlob(await response.blob()); } catch { await browserVoiceFallback(text); }
}

function browserVoiceFallback(text) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) return reject(new Error("Browser speech unavailable"));
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text || "").slice(0, 1800));
    utterance.lang = "en-US";
    utterance.rate = 1.03;
    utterance.pitch = 0.82;
    utterance.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => /daniel|aaron|evan|reed|male/i.test(voice.name) && /^en/i.test(voice.lang)) || voices.find((voice) => /^en-US/i.test(voice.lang)) || null;
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(event.error || "Browser speech failed"));
    window.speechSynthesis.speak(utterance);
  });
}

function syncVoiceOutput() {
  voiceOutputToggle?.setAttribute("aria-pressed", String(voiceOutputEnabled));
  voiceOutputToggle?.classList.toggle("active", voiceOutputEnabled);
  if (voiceOutputState) voiceOutputState.textContent = voiceOutputEnabled ? "Voice on" : "Voice muted";
}

voiceOutputToggle?.addEventListener("click", async () => {
  voiceOutputEnabled = !voiceOutputEnabled;
  localStorage.setItem("georgie:voiceOutput", voiceOutputEnabled ? "on" : "off");
  syncVoiceOutput();
  if (!voiceOutputEnabled) {
    stopActiveAudio();
    window.speechSynthesis?.cancel();
    setStatus("Voice muted. Full responses remain on screen.");
  } else {
    setStatus("Voice is on. Georgie will speak brief answers.");
    await browserVoiceFallback("Voice is on. I’m here.").catch(() => {});
  }
});

function attachHearResponse(item, text) {
  const button=document.createElement("button");button.className="hear-response";button.type="button";button.textContent="Hear response";
  button.addEventListener("click",async()=>{button.disabled=true;button.textContent="Speaking…";try{await speak(text);}catch(error){setStatus("Audio could not play. Check media volume and try again.");button.disabled=false;button.textContent="Try audio again";}});
  item.append(button);
}

async function sendTextTurn(input, { display = true, speakResponse = true, allowBusy = false } = {}) {
  const clean = String(input || "").trim();
  if (!clean || (isBusy && !allowBusy)) return;
  isBusy = true;
  const priorHistory = history.slice();
  if (display) appendMessage("user", clean);
  pushHistory("user", clean);
  setStatus("Thinking…");
  const requestStarted = performance.now();
  let headersAt = 0, firstEventAt = 0, firstDeltaAt = 0;

  try {
    const response = await fetch("/api/mobile/respond/stream", {
      method: "POST",
      headers: requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ input: clean, history: priorHistory, userId, sessionId })
    });
    headersAt = performance.now();
    if (!response.ok || !response.body) throw new Error("Streaming response unavailable");
    const assistantItem = appendMessage("assistant", "Working…");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", streamedText = "", payload = null;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (!firstEventAt) firstEventAt = performance.now();
        if (event.type === "status") setStatus(event.message || "Working…");
        if (event.type === "delta") { if (!firstDeltaAt) firstDeltaAt = performance.now(); streamedText = event.text || `${streamedText}${event.delta || ""}`; updateMessage(assistantItem, streamedText); }
        if (event.type === "final") payload = { ok: event.ok, ...event.result, spokenText: event.spokenText };
        if (event.type === "error") throw new Error(event.error || "Request failed");
      }
      if (done) break;
    }
    if (!payload?.ok) throw new Error("Georgie did not complete the response");
    updateMessage(assistantItem, payload.text);
    attachOutcomeFeedback(assistantItem, clean, payload);
    attachHearResponse(assistantItem, payload.spokenText || payload.text);
    void fetch("/api/mobile/telemetry", { method:"POST", headers:requestHeaders({"Content-Type":"application/json"}), body:JSON.stringify({ platform:"web", route:"respond_stream", headersMs:headersAt-requestStarted, firstEventMs:(firstEventAt||headersAt)-requestStarted, firstDeltaMs:(firstDeltaAt||performance.now())-requestStarted, completeMs:performance.now()-requestStarted }) }).catch(()=>{});
    pushHistory("assistant", payload.text);
    setStatus(payload.remembered ? `Speaking… remembered ${payload.remembered} new detail${payload.remembered === 1 ? "" : "s"}.` : "Speaking…");
    if (speakResponse) { try { await speak(payload.spokenText || payload.text); } catch (error) { console.warn("Automatic voice playback blocked",error); setStatus("Response ready — tap Hear response for audio."); } }
    return payload;
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong.");
    throw error;
  } finally {
    isBusy = false;
  }
}

async function transcribeBlob(audioBlob) {
  const form = new FormData();
  const extension = audioBlob.type.includes("mp4") ? "m4a" : "webm";
  form.append("audio", audioBlob, `voice.${extension}`);
  const response = await fetch("/api/mobile/transcribe", {
    method: "POST",
    headers: requestHeaders(),
    body: form
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Transcription failed");
  return payload.text.trim();
}

function isStandbyCommand(text) {
  return /^(never mind|nevermind|go to sleep|stand by|standby|stop listening|that'?s all|thats all)$/i.test(text.trim());
}

async function processHandsFreeSegment(blob, meta) {
  if (handsFreeBusy || isBusy) return;
  handsFreeBusy = true;
  try {
    const transcript = await transcribeBlob(blob);
    const wake = parseWakeTranscript(transcript);

    if (!meta.followUp && !wake.woke) {
      setStatus("Standing by for “Georgie”.");
      return;
    }

    if (wake.woke && !wake.command) {
      handsFree.activateFollowUp();
      await playWakeChime();
      setStatus("Yes?");
      return;
    }

    const command = wake.woke && wake.command ? wake.command : transcript;
    if (isStandbyCommand(command)) {
      handsFree.clearFollowUp();
      setStatus("Standing by. Say “Georgie” when you need me.");
      return;
    }

    handsFree.activateFollowUp();
    await sendTextTurn(command);
  } catch (error) {
    console.warn("Hands-free segment ignored", error);
    if (handsFree.enabled) setStatus("Standing by for “Georgie”.");
  } finally {
    handsFreeBusy = false;
  }
}

const handsFree = new HandsFreeEngine({
  onSegment: processHandsFreeSegment,
  onBargeIn: () => {
    stopActiveAudio({ interrupted: true });
    handsFree.activateFollowUp();
  },
  onState: (state) => {
    const labels = {
      off: "Manual mode",
      calibrating: "Calibrating room",
      standby: "Standing by",
      hearing: "Checking speech",
      active: "Awake",
      listening: "Listening",
      speaking: "Speaking",
      paused: "Temporarily paused"
    };
    setPresence(state, labels[state] || state);
    if (state === "standby") setStatus("Standing by for “Georgie”.");
    if (state === "calibrating") setStatus("Learning the room noise level…");
  }
});

async function toggleHandsFree() {
  const next = !handsFree.enabled;
  handsFreeToggle.disabled = true;
  try {
    if (next) {
      await handsFree.enable();
      handsFreeToggle.setAttribute("aria-checked", "true");
      localStorage.setItem("georgie:handsFree", "on");
      setStatus("Hands-free is on. Say “Georgie” when you need me.");
    } else {
      handsFree.disable();
      handsFreeToggle.setAttribute("aria-checked", "false");
      localStorage.setItem("georgie:handsFree", "off");
      setStatus("Hands-free is off. Hold the button to talk.");
    }
  } catch (error) {
    console.error(error);
    handsFreeToggle.setAttribute("aria-checked", "false");
    localStorage.setItem("georgie:handsFree", "off");
    setStatus(error.message || "Could not enable hands-free mode.");
  } finally {
    handsFreeToggle.disabled = false;
  }
}

async function runVoiceTurn(audioBlob) {
  if (isBusy) return;
  isBusy = true;
  voiceButton.disabled = true;

  try {
    setStatus("Got it — hearing you now…");
    playWakeChime().catch(() => {});
    const transcript = await transcribeBlob(audioBlob);
    appendMessage("user", transcript);
    setStatus("Understood — responding…");
    await sendTextTurn(transcript, { display: false, speakResponse: true, allowBusy: true });
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong.");
  } finally {
    isBusy = false;
    voiceButton.disabled = false;
    voiceLabel.textContent = "Hold to talk";
    voiceButton.classList.remove("recording");
    if (manualSuspendedHandsFree) {
      manualSuspendedHandsFree = false;
      handsFree.resume();
    }
  }
}

async function startRecording(event) {
  event.preventDefault();
  if (isBusy || mediaRecorder?.state === "recording") return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setStatus("This browser does not support microphone recording.");
    return;
  }

  try {
    if (handsFree.enabled) {
      handsFree.suspend();
      manualSuspendedHandsFree = true;
    }
    stopActiveAudio({ interrupted: true });
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    chunks = [];
    const mimeType = chooseMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", async () => {
      const type = mediaRecorder.mimeType || chunks[0]?.type || "audio/webm";
      const blob = new Blob(chunks, { type });
      mediaStream?.getTracks().forEach((track) => track.stop());
      mediaStream = null;
      if (blob.size > 0) await runVoiceTurn(blob);
    }, { once: true });
    mediaRecorder.start();
    voiceButton.classList.add("recording");
    voiceLabel.textContent = "Release to send";
    setStatus("I’m listening…");
  } catch (error) {
    console.error(error);
    if (manualSuspendedHandsFree) {
      manualSuspendedHandsFree = false;
      handsFree.resume();
    }
    setStatus("Microphone permission is required to talk to Georgie.");
  }
}

function stopRecording(event) {
  event.preventDefault();
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

handsFreeToggle.addEventListener("click", toggleHandsFree);
voiceButton.addEventListener("pointerdown", startRecording);
voiceButton.addEventListener("pointerup", stopRecording);
voiceButton.addEventListener("pointercancel", stopRecording);
voiceButton.addEventListener("pointerleave", (event) => {
  if (mediaRecorder?.state === "recording") stopRecording(event);
});

textForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = textInput.value.trim();
  if (!input || isBusy) return;
  textInput.value = "";
  await sendTextTurn(input).catch(() => {});
});

document.addEventListener("visibilitychange", () => {
  if (!handsFree.enabled) return;
  if (document.hidden) {
    handsFree.suspend();
    setStatus("Hands-free paused while Georgie is in the background.");
  } else {
    handsFree.resume();
    setStatus("Standing by for “Georgie”.");
  }
});

window.addEventListener("beforeunload", () => handsFree.disable());

setPresence("off", "Manual mode");
syncVoiceOutput();
restoreSession();
if (localStorage.getItem("georgie:handsFree") === "on") {
  setStatus("Tap Hands-free to resume microphone access.");
}
