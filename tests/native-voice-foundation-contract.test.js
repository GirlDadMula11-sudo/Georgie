import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../native/GeorgieVoiceKit/", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

test("shared Apple package targets current Mac and iPhone baselines", () => {
  const manifest = read("Package.swift");
  assert.match(manifest, /\.iOS\(\.v17\)/);
  assert.match(manifest, /\.macOS\(\.v14\)/);
});

test("Apple CI compiles macOS and iOS without signing or production mutation", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/native-voice.yml", import.meta.url), "utf8");
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /swift test --parallel/);
  assert.match(workflow, /generic\/platform=iOS/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.doesNotMatch(workflow, /deploy|release|upload-artifact/);
});

test("standby buffer is bounded, encrypted and exposes no network transport", () => {
  const source = read("Sources/GeorgieVoiceKit/EncryptedStandbyBuffer.swift");
  assert.match(source, /AES\.GCM\.seal/);
  assert.match(source, /maximumBytes/);
  assert.match(source, /retention/);
  assert.doesNotMatch(source, /URLSession|NWConnection|upload|HTTP/);
});

test("wake and speaker decisions happen before durable network submission", () => {
  const wake = read("Sources/GeorgieVoiceKit/LocalWakePipeline.swift");
  const transport = read("Sources/GeorgieVoiceKit/DurableVoiceTurnClient.swift");
  assert.match(wake, /wakeThreshold/);
  assert.match(wake, /speakerThreshold/);
  assert.match(wake, /speaker_not_verified/);
  assert.doesNotMatch(wake, /URLSession|respond\/stream/);
  assert.match(transport, /VerifiedVoiceCommand/);
  assert.match(transport, /api\/mobile\/respond\/stream/);
  assert.match(transport, /Idempotency-Key/);
});

test("post-wake transcription is forced on device", () => {
  const source = read("Sources/GeorgieVoiceKit/OnDeviceTranscriber.swift");
  assert.match(source, /supportsOnDeviceRecognition/);
  assert.match(source, /requiresOnDeviceRecognition = true/);
  assert.match(source, /contextualStrings/);
});
