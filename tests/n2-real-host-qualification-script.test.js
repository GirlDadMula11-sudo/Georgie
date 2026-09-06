import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("N2 real-host qualification campaign parses without executing", () => {
  const script = fileURLToPath(new URL("../scripts/run-n2-real-host-qualification.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--check", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
