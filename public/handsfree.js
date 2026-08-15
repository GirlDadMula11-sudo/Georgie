const DEFAULTS = {
  wakeNames: ["georgie", "hey georgie", "okay georgie", "ok georgie"],
  followUpMs: 14000,
  silenceMs: 850,
  minSpeechMs: 260,
  maxUtteranceMs: 12000,
  calibrationMs: 1200,
  thresholdMultiplier: 2.35,
  thresholdFloor: 0.018,
  bargeInMs: 260
};

export class HandsFreeEngine {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.enabled = false;
    this.state = "off";
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.frame = null;
    this.noiseFloor = this.options.thresholdFloor;
    this.threshold = this.options.thresholdFloor * this.options.thresholdMultiplier;
    this.speechStartedAt = 0;
    this.lastVoiceAt = 0;
    this.recordingStartedAt = 0;
    this.recorder = null;
    this.chunks = [];
    this.followUpUntil = 0;
    this.isAssistantSpeaking = false;
    this.bargeStartedAt = 0;
    this.suspendDepth = 0;
    this.onSegment = options.onSegment || (() => {});
    this.onState = options.onState || (() => {});
    this.onBargeIn = options.onBargeIn || (() => {});
  }

  get isFollowUpActive() {
    return Date.now() < this.followUpUntil;
  }

  setState(next, detail = {}) {
    if (this.state === next && !detail.force) return;
    this.state = next;
    this.onState(next, { ...detail, followUpUntil: this.followUpUntil });
  }

  chooseMimeType() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  async enable() {
    if (this.enabled) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Hands-free microphone mode is not supported by this browser.");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Audio analysis is not supported by this browser.");
    this.context = new AudioContext();
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.12;
    this.source.connect(this.analyser);

    this.enabled = true;
    this.setState("calibrating", { force: true });
    await this.calibrate();
    this.setState("standby", { force: true });
    this.monitor();
  }

  async calibrate() {
    const samples = [];
    const until = performance.now() + this.options.calibrationMs;
    while (this.enabled && performance.now() < until) {
      samples.push(this.level());
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (!samples.length) return;
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length * 0.5)] || this.options.thresholdFloor;
    const upper = samples[Math.floor(samples.length * 0.8)] || median;
    this.noiseFloor = Math.max(this.options.thresholdFloor, median * 0.65 + upper * 0.35);
    this.threshold = Math.max(this.options.thresholdFloor, this.noiseFloor * this.options.thresholdMultiplier);
  }

  level() {
    if (!this.analyser) return 0;
    const values = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(values);
    let sum = 0;
    for (const sample of values) sum += sample * sample;
    return Math.sqrt(sum / values.length);
  }

  monitor = () => {
    if (!this.enabled) return;
    const now = performance.now();
    const rms = this.level();
    const voiced = rms >= this.threshold;

    if (!voiced && !this.recorder && !this.isAssistantSpeaking) {
      this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;
      this.threshold = Math.max(this.options.thresholdFloor, this.noiseFloor * this.options.thresholdMultiplier);
    }

    if (this.suspendDepth === 0) {
      if (this.isAssistantSpeaking) {
        const bargeThreshold = Math.max(this.threshold * 1.75, 0.04);
        if (rms >= bargeThreshold) {
          if (!this.bargeStartedAt) this.bargeStartedAt = now;
          if (now - this.bargeStartedAt >= this.options.bargeInMs) {
            this.bargeStartedAt = 0;
            this.onBargeIn();
            this.startSegment();
          }
        } else {
          this.bargeStartedAt = 0;
        }
      } else if (voiced) {
        this.lastVoiceAt = now;
        if (!this.speechStartedAt) this.speechStartedAt = now;
        if (!this.recorder && now - this.speechStartedAt >= this.options.minSpeechMs) this.startSegment();
      } else {
        this.speechStartedAt = 0;
      }

      if (this.recorder?.state === "recording") {
        if (voiced) this.lastVoiceAt = now;
        const silentFor = now - this.lastVoiceAt;
        const duration = now - this.recordingStartedAt;
        if (silentFor >= this.options.silenceMs || duration >= this.options.maxUtteranceMs) this.stopSegment();
      }
    }

    this.frame = requestAnimationFrame(this.monitor);
  };

  startSegment() {
    if (!this.enabled || this.recorder?.state === "recording" || !this.stream) return;
    this.chunks = [];
    const mimeType = this.chooseMimeType();
    this.recorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    });
    this.recorder.addEventListener("stop", () => {
      const type = this.recorder?.mimeType || this.chunks[0]?.type || "audio/webm";
      const blob = new Blob(this.chunks, { type });
      this.recorder = null;
      this.chunks = [];
      if (blob.size > 600) this.onSegment(blob, { followUp: this.isFollowUpActive, recordedAt: Date.now() });
      if (this.enabled && !this.isAssistantSpeaking) this.setState(this.isFollowUpActive ? "active" : "standby");
    }, { once: true });
    this.recordingStartedAt = performance.now();
    this.lastVoiceAt = performance.now();
    this.recorder.start(150);
    this.setState(this.isFollowUpActive ? "listening" : "hearing");
  }

  stopSegment() {
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  activateFollowUp(ms = this.options.followUpMs) {
    this.followUpUntil = Date.now() + ms;
    if (this.enabled && !this.isAssistantSpeaking) this.setState("active", { force: true });
  }

  clearFollowUp() {
    this.followUpUntil = 0;
    if (this.enabled && !this.isAssistantSpeaking) this.setState("standby", { force: true });
  }

  setAssistantSpeaking(value) {
    this.isAssistantSpeaking = Boolean(value);
    if (!this.enabled) return;
    this.setState(value ? "speaking" : (this.isFollowUpActive ? "active" : "standby"), { force: true });
  }

  suspend() {
    this.suspendDepth += 1;
    if (this.enabled) this.setState("paused", { force: true });
  }

  resume() {
    this.suspendDepth = Math.max(0, this.suspendDepth - 1);
    if (this.enabled && this.suspendDepth === 0) this.setState(this.isFollowUpActive ? "active" : "standby", { force: true });
  }

  disable() {
    this.enabled = false;
    this.followUpUntil = 0;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.recorder = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.context?.close().catch(() => {});
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.setState("off", { force: true });
  }
}

export function parseWakeTranscript(transcript, wakeNames = DEFAULTS.wakeNames) {
  const raw = String(transcript || "").trim();
  const normalized = raw.toLowerCase().replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return { woke: false, command: "", transcript: raw };

  const ordered = [...wakeNames].sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    const target = name.toLowerCase().replace(/\s+/g, " ").trim();
    const index = normalized.indexOf(target);
    if (index === -1) continue;
    const beforeOkay = index === 0 || /\s$/.test(normalized.slice(0, index));
    const afterIndex = index + target.length;
    const afterOkay = afterIndex === normalized.length || /^\s/.test(normalized.slice(afterIndex));
    if (!beforeOkay || !afterOkay) continue;

    const originalLower = raw.toLowerCase();
    const originalIndex = originalLower.indexOf(target);
    const command = originalIndex >= 0 ? raw.slice(originalIndex + target.length).replace(/^[\s,.:;!?-]+/, "").trim() : "";
    return { woke: true, command, transcript: raw, wakeName: target };
  }

  return { woke: false, command: "", transcript: raw };
}
