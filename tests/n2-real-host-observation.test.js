import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeHardwareProfile } from "../src/native-hardware-profile.js";

const SHA256 = /^[a-f0-9]{64}$/;

test("N2 real-host observation emits a promotion-grade hardware profile on macOS", (t) => {
  if (process.platform !== "darwin") {
    t.skip("real N2 host observation is emitted only on macOS; CI remains a structural gate");
    return;
  }

  const profile = buildNativeHardwareProfile();

  assert.equal(profile.schema, "sierra.native-semantic-host-profile.v2");
  assert.equal(profile.hardware?.platform, "darwin");
  assert.match(String(profile.hardwareFingerprintSha256 || ""), SHA256);
  assert.match(String(profile.runtimeFingerprintSha256 || ""), SHA256);
  assert.ok(Number(profile.hardware?.memory?.totalBytes) > 0, "host memory must be measurable");
  assert.ok(String(profile.hardware?.arch || "").length > 0, "host architecture must be measurable");
  assert.ok(String(profile.hardware?.cpu?.model || profile.hardware?.cpu?.apple?.chip || "").length > 0, "host CPU/chip identity must be measurable");

  // One machine-readable marker is intentionally emitted so the governed
  // developer.run_checks receipt can carry the exact profile back without
  // granting a new shell or host-inspection capability.
  console.log(`N2_HOST_PROFILE_JSON:${JSON.stringify(profile)}`);
});
