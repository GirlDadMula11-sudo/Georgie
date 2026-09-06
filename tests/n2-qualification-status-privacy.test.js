import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readN2QualificationStatus, DEFAULT_N2_QUALIFICATION_ROOT } from "../src/n2-qualification-status.js";

function lockFs(lockPayload) {
  const lock = path.join(DEFAULT_N2_QUALIFICATION_ROOT, "campaign-launch.lock.json");
  return {
    async readdir() {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    async readFile(file) {
      if (file === lock) return JSON.stringify(lockPayload);
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
  };
}

test("live process identity is used only for liveness and never leaves the projection", async () => {
  const status = await readN2QualificationStatus({
    fsImpl: lockFs({
      pid: 4321,
      launchedAt: "2026-09-06T23:00:00.000Z",
      hostHardwareFingerprintSha256: "a".repeat(64),
    }),
    root: DEFAULT_N2_QUALIFICATION_ROOT,
    processSignal(pid, signal) {
      assert.equal(pid, 4321);
      assert.equal(signal, 0);
    },
  });

  assert.equal(status.status, "running");
  assert.equal(status.promotionAuthority, "none");
  assert.equal(Object.hasOwn(status, "pid"), false);
  assert.doesNotMatch(JSON.stringify(status), /4321/);
});

test("stale lock also strips the process identifier", async () => {
  const status = await readN2QualificationStatus({
    fsImpl: lockFs({ pid: 9876, launchedAt: "2026-09-06T23:00:00.000Z" }),
    root: DEFAULT_N2_QUALIFICATION_ROOT,
    processSignal() {
      const error = new Error("dead");
      error.code = "ESRCH";
      throw error;
    },
  });

  assert.equal(status.status, "stale_lock");
  assert.equal(Object.hasOwn(status, "pid"), false);
  assert.doesNotMatch(JSON.stringify(status), /9876/);
});
