const voiceButton = document.querySelector("#voiceButton");
const voiceLabel = document.querySelector("#voiceLabel");
const statusEl = document.querySelector("#status");
const conversationEl = document.querySelector("#conversation");
const textForm = document.querySelector("#textForm");
const textInput = document.querySelector("#textInput");

let mediaRecorder;
let mediaStream;
let chunks = [];
let history = [];
let activeAudio;
let isBusy = false;

const userId = localStorage.getItem("georgie:userId") || crypto.randomUUID();
const sessionId = localStorage.getItem("georgie:sessionId") || crypto.randomUUID();
localStorage.setItem("georgie:userId", userId);
localStorage.setItem("georgie:sessionId", sessionId);

function requestHeaders(extra = {}) {
  return {
    "X-Georgie-User": userId,
    "X-Georgie-Session": sessionId,
    ...extra
  };
}

function setStatus(text) {
  statusEl.textContent = text;
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
  conversationEl.append(item);
  item.scrollIntoView({ behavior: "smooth", block: "end" });
}

function pushHistory(role, content) {
  history.push({ role, content });
  history = history.slice(-16);
}

async function restoreSession() {
  try {
    const response = await fetch(`/api/session?limit=16`, { headers: requestHeaders() });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !Array.isArray(payload.history)) return;
    history = payload.history.slice(-16);
    for (const turn of history) {
      if (["user", "assistant"].includes(turn.role) && turn.content) appendMessage(turn.role, turn.content);
    }
    if (history.length) setStatus("Memory restored. Ready when you are.");
  } catch (error) {
    console.warn("Session restore unavailable", error);
  }
}

function chooseMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function playBase64Audio(base64, mimeType = "audio/mpeg") {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }

  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  activeAudio = new Audio(url);

  activeAudio.addEventListener("ended", () => {
    URL.revokeObjectURL(url);
    activeAudio = null;
    setStatus("Ready when you are.");
  }, { once: true });

  await activeAudio.play();
}

async function runVoiceTurn(audioBlob) {
  if (isBusy) return;
  isBusy = true;
  voiceButton.disabled = true;

  try {
    setStatus("Listening closely…");
    const form = new FormData();
    const extension = audioBlob.type.includes("mp4") ? "m4a" : "webm";
    form.append("audio", audioBlob, `voice.${extension}`);
    form.append("history", JSON.stringify(history));
    form.append("userId", userId);
    form.append("sessionId", sessionId);

    setStatus("Thinking…");
    const response = await fetch("/api/voice-turn", {
      method: "POST",
      headers: requestHeaders(),
      body: form
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Voice request failed");

    appendMessage("user", payload.transcript);
    pushHistory("user", payload.transcript);
    appendMessage("assistant", payload.text);
    pushHistory("assistant", payload.text);

    setStatus(payload.remembered ? `Speaking… remembered ${payload.remembered} new detail${payload.remembered === 1 ? "" : "s"}.` : "Speaking…");
    await playBase64Audio(payload.audioBase64, payload.audioMimeType);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong.");
  } finally {
    isBusy = false;
    voiceButton.disabled = false;
    voiceLabel.textContent = "Hold to talk";
    voiceButton.classList.remove("recording");
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
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    chunks = [];
    const mimeType = chooseMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);

    mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data?.size) chunks.push(e.data);
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
    setStatus("Microphone permission is required to talk to Georgie.");
  }
}

function stopRecording(event) {
  event.preventDefault();
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

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

  isBusy = true;
  textInput.value = "";
  appendMessage("user", input);
  const priorHistory = history.slice();
  pushHistory("user", input);
  setStatus("Thinking…");

  try {
    const response = await fetch("/api/respond", {
      method: "POST",
      headers: requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ input, history: priorHistory, userId, sessionId })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Request failed");

    appendMessage("assistant", payload.text);
    pushHistory("assistant", payload.text);
    setStatus(payload.remembered ? `Speaking… remembered ${payload.remembered} new detail${payload.remembered === 1 ? "" : "s"}.` : "Speaking…");

    const speechResponse = await fetch("/api/speak", {
      method: "POST",
      headers: requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: payload.text })
    });
    if (!speechResponse.ok) throw new Error("Speech synthesis failed");

    const blob = await speechResponse.blob();
    const url = URL.createObjectURL(blob);
    activeAudio = new Audio(url);
    activeAudio.addEventListener("ended", () => {
      URL.revokeObjectURL(url);
      activeAudio = null;
      setStatus("Ready when you are.");
    }, { once: true });
    await activeAudio.play();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong.");
  } finally {
    isBusy = false;
  }
});

restoreSession();
