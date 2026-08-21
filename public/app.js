import { HandsFreeEngine, parseWakeTranscript } from "./handsfree.js";
import { authHeaders, georgieDeviceReady } from "./device-auth.js";

const voiceButton = document.querySelector("#voiceButton");
const voiceLabel = document.querySelector("#voiceLabel");
const statusEl = document.querySelector("#status");
const conversationEl = document.querySelector("#conversation");
const textForm = document.querySelector("#textForm");
const textInput = document.querySelector("#textInput");
const attachmentInput = document.querySelector("#attachmentInput");
const attachmentButton = document.querySelector("#attachmentButton");
const attachmentTray = document.querySelector("#attachmentTray");
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
let selectedAttachments = [];

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

function appendMessage(role, text, attachments = []) {
  const item = document.createElement("article");
  item.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "Georgie";
  const body = document.createElement("p");
  body.textContent = text;
  item.append(label, body);
  if (attachments.length) {
    const list=document.createElement("div");list.className="message-attachments";
    for(const file of attachments){const chip=document.createElement("span");chip.className="message-attachment";chip.textContent=`▧ ${file.name}`;list.append(chip);}
    item.append(list);
  }
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

function createExecutionPanel(item, startedAt) {
  const panel=document.createElement("details");
  panel.className="execution-panel";
  panel.open=true;
  panel.innerHTML='<summary><span class="execution-signal"></span><strong>Georgie is working</strong><time>0.0s</time></summary><div class="execution-steps"></div><div class="execution-receipt"></div>';
  item.append(panel);
  panel._startedAt=startedAt;
  panel._timer=setInterval(()=>{
    const time=panel.querySelector("time");
    if(time)time.textContent=`${((performance.now()-startedAt)/1000).toFixed(1)}s`;
  },100);
  return panel;
}

function executionStep(panel,key,label,state="running"){
  const list=panel?.querySelector(".execution-steps");
  if(!list)return;
  let row=list.querySelector(`[data-step="${CSS.escape(key)}"]`);
  if(!row){row=document.createElement("div");row.dataset.step=key;row.innerHTML="<i></i><span></span>";list.append(row);}
  row.className=`execution-step ${state}`;
  row.querySelector("span").textContent=label;
}

function updateExecutionPanel(panel,event){
  if(!panel||!event)return;
  const stage=event.stage||event.type;
  const key=event.tool?`tool:${event.tool}`:`stage:${stage}`;
  if(stage==="accepted")executionStep(panel,key,"Request accepted","done");
  else if(stage==="plan_ready")executionStep(panel,key,event.message||"Governed plan ready","done");
  else if(stage==="tool_running")executionStep(panel,key,event.message||`Running ${event.tool}`,"running");
  else if(stage==="tool_complete")executionStep(panel,key,event.message||`${event.tool} finished`,event.ok===false?"failed":"done");
  else if(stage==="evidence")executionStep(panel,key,event.message||"Evidence assembled","done");
  else if(stage==="verification")executionStep(panel,key,event.message||"Verifying outcome",event.ok===false?"failed":"running");
  else if(stage==="plan_recovered")executionStep(panel,key,event.message||"Repair plan recovered","done");
  else if(stage==="planning_failed")executionStep(panel,key,event.message||"Planning failed","failed");
  else if(stage==="heartbeat")executionStep(panel,"stage:heartbeat",event.message||"Still working — durable connection active","running");
}

async function recoverDurableTurn(requestId,{attempts=45,delayMs=1500}={}){
  if(!requestId)return null;
  for(let attempt=0;attempt<attempts;attempt+=1){
    try{
      const response=await fetch(`/api/mobile/turns/${encodeURIComponent(requestId)}`,{headers:requestHeaders(),cache:"no-store"});
      const payload=await response.json();
      if(response.ok&&payload?.job){
        if(payload.job.result)return{ok:true,...payload.job.result,requestId};
        if(payload.job.status==="blocked")throw new Error(payload.job.error||payload.job.message||"Durable task blocked");
      }
    }catch(error){if(attempt===attempts-1)throw error;}
    await new Promise(resolve=>setTimeout(resolve,delayMs));
  }
  return null;
}

function finishExecutionPanel(panel,payload,{failed=false}={}){
  if(!panel)return;
  clearInterval(panel._timer);
  const elapsed=Number(payload?.latencyMs)||(performance.now()-panel._startedAt);
  const time=panel.querySelector("time");
  if(time)time.textContent=`${(elapsed/1000).toFixed(1)}s`;
  const actions=Array.isArray(payload?.actions)?payload.actions:[];
  const failedActions=actions.filter(action=>action?.ok===false);
  const rawTerminalState=failed?"blocked":payload?.terminalState||(payload?.completed===false?"in_progress":failedActions.length?"blocked":"completed");
  const terminalState=["verified","partial"].includes(rawTerminalState)&&payload?.completed!==false?"completed":rawTerminalState;
  panel.classList.remove("running","complete","completed","blocked","approval_needed","in_progress","failed");
  panel.classList.add(terminalState);
  if(terminalState==="completed")panel.classList.add("complete");
  if(terminalState==="blocked")panel.classList.add("failed");
  const title=panel.querySelector("summary strong");
  if(title)title.textContent={completed:"Task completed",blocked:"Task blocked",approval_needed:"Approval needed",in_progress:"Task in progress"}[terminalState]||"Task update";
  const receipt=panel.querySelector(".execution-receipt");
  if(receipt){
    const evidence=Number(payload?.evidence?.length||0);
    receipt.textContent=terminalState==="completed"?(actions.length?`${actions.length} tool${actions.length===1?"":"s"} · ${evidence} evidence source${evidence===1?"":"s"} · terminal outcome recorded`:"No tools required."):terminalState==="in_progress"?"Work started; completion awaits terminal business evidence.":"No completion was claimed.";
  }
  panel.open=terminalState!=="completed";
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

function recordVoiceTelemetry(event, detail = {}) {
  void fetch("/api/mobile/telemetry", {
    method: "POST",
    headers: requestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ platform: "web", route: "voice_output", event, ...detail })
  }).catch(() => {});
}

async function unlockVoicePlayback() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  try {
    await context.resume();
    const buffer = context.createBuffer(1, 1, 22050);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
    recordVoiceTelemetry("audio_unlocked");
  } finally {
    setTimeout(() => context.close().catch(() => {}), 250);
  }
}

async function speak(text) {
  if (!voiceOutputEnabled) return;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/mobile/speak", {
      method: "POST",
      headers: requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Speech request failed (${response.status})`);
    await playAudioBlob(await response.blob());
    recordVoiceTelemetry("server_audio_playing");
  } catch (error) {
    recordVoiceTelemetry("server_audio_failed", { error: String(error?.message || error).slice(0, 240) });
    await browserVoiceFallback(text);
    recordVoiceTelemetry("browser_fallback_playing");
  } finally {
    clearTimeout(deadline);
  }
}

function browserVoiceFallback(text) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) return reject(new Error("Browser speech unavailable"));
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      error ? reject(error) : resolve();
    };
    const deadline = setTimeout(() => {
      window.speechSynthesis.cancel();
      finish(new Error("Browser speech exceeded its playback deadline"));
    }, 20000);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text || "").slice(0, 1800));
    utterance.lang = "en-US";
    utterance.rate = 1.03;
    utterance.pitch = 0.82;
    utterance.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => /daniel|aaron|evan|reed|male/i.test(voice.name) && /^en/i.test(voice.lang)) || voices.find((voice) => /^en-US/i.test(voice.lang)) || null;
    utterance.onend = () => finish();
    utterance.onerror = (event) => finish(new Error(event.error || "Browser speech failed"));
    window.speechSynthesis.speak(utterance);
  });
}

function syncVoiceOutput() {
  voiceOutputToggle?.setAttribute("aria-pressed", String(voiceOutputEnabled));
  voiceOutputToggle?.classList.toggle("active", voiceOutputEnabled);
  if (voiceOutputState) voiceOutputState.textContent = voiceOutputEnabled ? "Voice on" : "Voice muted";
}

voiceOutputToggle?.addEventListener("click", async () => {
  const unlock = unlockVoicePlayback().catch(() => {});
  voiceOutputEnabled = !voiceOutputEnabled;
  localStorage.setItem("georgie:voiceOutput", voiceOutputEnabled ? "on" : "off");
  syncVoiceOutput();
  if (!voiceOutputEnabled) {
    stopActiveAudio();
    window.speechSynthesis?.cancel();
    setStatus("Voice muted. Full responses remain on screen.");
  } else {
    setStatus("Turning Georgie’s voice on…");
    await unlock;
    try {
      await speak("Voice is on. I’m here.");
      setStatus("Voice is on. Georgie will speak brief answers.");
    } catch (error) {
      recordVoiceTelemetry("all_playback_failed", { error: String(error?.message || error).slice(0, 240) });
      setStatus("Audio could not play. Check media volume and tap the voice button again.");
    }
  }
});

function attachHearResponse(item, text) {
  const button=document.createElement("button");button.className="hear-response";button.type="button";button.textContent="Hear response";
  button.addEventListener("click",async()=>{button.disabled=true;button.textContent="Speaking…";try{await speak(text);}catch(error){setStatus("Audio could not play. Check media volume and try again.");button.disabled=false;button.textContent="Try audio again";}});
  item.append(button);
}

async function sendTextTurn(input, { display = true, speakResponse = true, allowBusy = false, attachments = [] } = {}) {
  const clean = String(input || "").trim();
  if ((!clean && !attachments.length) || (isBusy && !allowBusy)) return;
  const effectiveInput=clean||"Analyze the attached files.";
  isBusy = true;
  const priorHistory = history.slice();
  if (display) appendMessage("user", effectiveInput, attachments);
  pushHistory("user", attachments.length?`${effectiveInput}\n\n[Attached files: ${attachments.map(file=>file.name).join(", ")}]`:effectiveInput);
  setStatus("Thinking…");
  const requestStarted = performance.now();
  let headersAt = 0, firstEventAt = 0, firstDeltaAt = 0;
  let durableRequestId = null;
  let assistantItem = null;
  // The server owns the bounded turn lifecycle. A browser timer must never
  // cancel durable tool work or discard a terminal result that is still arriving.
  const progressDeadlineMs = 20000;
  const deadline = setTimeout(() => setStatus("Still working safely — any long-running tool remains durable and Georgie will return a terminal result."), progressDeadlineMs);

  try {
    let endpoint="/api/mobile/respond/stream",headers,body;
    if(attachments.length){const form=new FormData();form.append("input",effectiveInput);form.append("history",JSON.stringify(priorHistory));for(const file of attachments)form.append("files",file,file.name);endpoint="/api/mobile/respond/stream-with-files";headers=requestHeaders();body=form;}
    else{headers=requestHeaders({"Content-Type":"application/json"});body=JSON.stringify({input:effectiveInput,history:priorHistory,userId,sessionId});}
    const response = await fetch(endpoint, { method: "POST", headers, body });
    headersAt = performance.now();
    durableRequestId=response.headers.get("X-Georgie-Request-Id")||null;
    if(durableRequestId)localStorage.setItem("georgie:activeTurn",durableRequestId);
    if (!response.ok || !response.body) throw new Error("Streaming response unavailable");
    assistantItem = appendMessage("assistant", "Working…");
    const executionPanel=createExecutionPanel(assistantItem,requestStarted);
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
        if(event.requestId){durableRequestId=event.requestId;executionPanel.dataset.requestId=durableRequestId;localStorage.setItem("georgie:activeTurn",durableRequestId);}
        if (!firstEventAt) firstEventAt = performance.now();
        if (event.type === "status") { setStatus(event.message || "Working…"); updateExecutionPanel(executionPanel,event); }
        if (event.type === "complete") updateExecutionPanel(executionPanel,event);
        if (event.type === "delta") { if (!firstDeltaAt) firstDeltaAt = performance.now(); streamedText = event.text || `${streamedText}${event.delta || ""}`; updateMessage(assistantItem, streamedText); }
        if (event.type === "final") payload = { ok: event.ok, ...event.result, spokenText: event.spokenText };
        if (event.type === "error") throw new Error(event.error || "Request failed");
      }
      if (done) break;
    }
    if (!payload?.ok) throw new Error("Georgie did not complete the response");
    localStorage.removeItem("georgie:activeTurn");
    updateMessage(assistantItem, payload.text);
    finishExecutionPanel(executionPanel,payload);
    if(payload.investigationArtifact?.id&&Array.isArray(payload.investigationArtifact.sections)){
      for(const sectionId of payload.investigationArtifact.sections){await fetch(`/api/mobile/investigations/${payload.investigationArtifact.id}/delivery`,{method:"POST",headers:requestHeaders({"Content-Type":"application/json"}),body:JSON.stringify({sectionId})});}
    }
    attachOutcomeFeedback(assistantItem, effectiveInput, payload);
    attachHearResponse(assistantItem, payload.spokenText || payload.text);
    void fetch("/api/mobile/telemetry", { method:"POST", headers:requestHeaders({"Content-Type":"application/json"}), body:JSON.stringify({ platform:"web", route:"respond_stream", headersMs:headersAt-requestStarted, firstEventMs:(firstEventAt||headersAt)-requestStarted, firstDeltaMs:(firstDeltaAt||performance.now())-requestStarted, completeMs:performance.now()-requestStarted }) }).catch(()=>{});
    pushHistory("assistant", payload.text);
    setStatus(payload.remembered ? `Response ready — remembered ${payload.remembered} new detail${payload.remembered === 1 ? "" : "s"}.` : "Response ready.");
    if (speakResponse) void speak(payload.spokenText || payload.text).catch((error) => { console.warn("Automatic voice playback blocked",error); setStatus("Response ready — tap Hear response for audio."); });
    return payload;
  } catch (error) {
    console.error(error);
    durableRequestId=durableRequestId||error?.requestId||assistantItem?.querySelector(".execution-panel")?.dataset?.requestId||null;
    if(durableRequestId){
      try{
        setStatus("Connection interrupted. Reconnecting to the durable task…");
        const recovered=await recoverDurableTurn(durableRequestId);
        if(recovered){
          if(!assistantItem)assistantItem=appendMessage("assistant",recovered.text||"Task result recovered.");else updateMessage(assistantItem,recovered.text||"Task result recovered.");
          finishExecutionPanel(assistantItem.querySelector(".execution-panel"),recovered);
          attachOutcomeFeedback(assistantItem,effectiveInput,recovered);attachHearResponse(assistantItem,recovered.spokenText||recovered.text);pushHistory("assistant",recovered.text);setStatus("Task result recovered after reconnect.");
          localStorage.removeItem("georgie:activeTurn");
          return recovered;
        }
        error=new Error(`Durable request ${durableRequestId} is still running. Its result remains saved and reconnectable from the activity center.`);
      }catch(recoveryError){error=new Error(`Durable task blocked: ${String(recoveryError?.message||recoveryError)}`);}
    }
    const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError";
    const failureText = timedOut ? "That request exceeded Georgie’s response deadline and was stopped. I did not verify completion, and nothing should be treated as completed." : `I could not complete that request: ${String(error?.message || "the response pipeline failed").slice(0,300)}. Nothing should be treated as completed.`;
    if (assistantItem) { updateMessage(assistantItem, failureText); finishExecutionPanel(assistantItem.querySelector(".execution-panel"),null,{failed:true}); } else assistantItem = appendMessage("assistant", failureText);
    attachHearResponse(assistantItem, failureText);
    pushHistory("assistant", failureText);
    setStatus(timedOut ? "Request stopped at the deadline. A failure report is on screen." : "Request failed. A failure report is on screen.");
    if (speakResponse) void speak(failureText).catch(()=>{});
    throw error;
  } finally {
    clearTimeout(deadline);
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

function renderAttachmentTray(){attachmentTray.replaceChildren();selectedAttachments.forEach((file,index)=>{const chip=document.createElement("div");chip.className="attachment-chip";const name=document.createElement("span");name.textContent=`${file.name} · ${(file.size/1024/1024).toFixed(file.size>1024*1024?1:2)} MB`;const remove=document.createElement("button");remove.type="button";remove.setAttribute("aria-label",`Remove ${file.name}`);remove.textContent="×";remove.addEventListener("click",()=>{selectedAttachments.splice(index,1);renderAttachmentTray();});chip.append(name,remove);attachmentTray.append(chip);});}
attachmentButton.addEventListener("click",()=>attachmentInput.click());
attachmentInput.addEventListener("change",()=>{const incoming=[...(attachmentInput.files||[])];const combined=[...selectedAttachments,...incoming];if(combined.length>5){setStatus("Attach up to 5 files at once.");selectedAttachments=combined.slice(0,5);}else selectedAttachments=combined;attachmentInput.value="";renderAttachmentTray();});

textForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = textInput.value.trim();
  if ((!input && !selectedAttachments.length) || isBusy) return;
  const attachments=[...selectedAttachments];selectedAttachments=[];renderAttachmentTray();
  textInput.value = "";
  await sendTextTurn(input,{attachments}).catch(() => {});
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
const interruptedTurnId=localStorage.getItem("georgie:activeTurn");
if(interruptedTurnId){
  const item=appendMessage("assistant","Reconnecting to your unfinished Georgie task…");
  const panel=createExecutionPanel(item,performance.now());panel.dataset.requestId=interruptedTurnId;
  setStatus("Recovering the durable task result…");
  recoverDurableTurn(interruptedTurnId).then(result=>{
    if(!result)return;
    updateMessage(item,result.text||"Durable task result recovered.");finishExecutionPanel(panel,result);attachHearResponse(item,result.spokenText||result.text);pushHistory("assistant",result.text);localStorage.removeItem("georgie:activeTurn");setStatus("Recovered the completed task after refresh.");
  }).catch(error=>{const text=`Task blocked: ${String(error?.message||error)}`;updateMessage(item,text);finishExecutionPanel(panel,null,{failed:true});attachHearResponse(item,text);localStorage.removeItem("georgie:activeTurn");setStatus("Recovered the task’s exact blocker.");});
}
if (localStorage.getItem("georgie:handsFree") === "on") {
  setStatus("Tap Hands-free to resume microphone access.");
}
