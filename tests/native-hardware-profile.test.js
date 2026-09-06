import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeHardwareProfile, canonicalJson } from "../src/native-hardware-profile.js";

function fakeOs({ model = "CPU A", logical = 8, memory = 16 * 1024 ** 3, release = "1.0" } = {}) {
  return {
    cpus: () => Array.from({ length: logical }, () => ({ model })),
    totalmem: () => memory,
    release: () => release,
  };
}

test("canonicalJson includes nested object fields deterministically", () => {
  const a = { z: { b: 2, a: 1 }, a: [{ y: 2, x: 1 }] };
  const b = { a: [{ x: 1, y: 2 }], z: { a: 1, b: 2 } };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.match(canonicalJson(a), /\"a\":1/);
  assert.match(canonicalJson(a), /\"b\":2/);
});

test("runtime changes do not alter stable hardware fingerprint", () => {
  const first = buildNativeHardwareProfile({ osModule: fakeOs({ release: "1.0" }), run: () => "" });
  const second = buildNativeHardwareProfile({ osModule: fakeOs({ release: "2.0" }), run: () => "" });
  assert.equal(first.hardwareFingerprintSha256, second.hardwareFingerprintSha256);
  assert.notEqual(first.runtimeFingerprintSha256, second.runtimeFingerprintSha256);
  assert.equal(first.fingerprintSha256, first.hardwareFingerprintSha256);
});

test("material hardware changes alter hardware fingerprint", () => {
  const first = buildNativeHardwareProfile({ osModule: fakeOs({ model: "CPU A", memory: 16 * 1024 ** 3 }), run: () => "" });
  const second = buildNativeHardwareProfile({ osModule: fakeOs({ model: "CPU B", memory: 32 * 1024 ** 3 }), run: () => "" });
  assert.notEqual(first.hardwareFingerprintSha256, second.hardwareFingerprintSha256);
});

test("host profile emits promotion-compatible SHA-256 identities", () => {
  const profile = buildNativeHardwareProfile({ osModule: fakeOs(), run: () => "" });
  assert.equal(profile.schema, "sierra.native-semantic-host-profile.v2");
  assert.match(profile.hardwareFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.match(profile.runtimeFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.match(profile.fingerprintSha256, /^[a-f0-9]{64}$/);
});
