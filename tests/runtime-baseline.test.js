import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;

test("production boot verifies committed runtime without installer mutation", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.prestart, "node scripts/verify-runtime-baseline.mjs");
  assert.doesNotMatch(pkg.scripts.prestart, /install-|repair-/);
  assert.match(execFileSync(process.execPath, ["scripts/verify-runtime-baseline.mjs"], { cwd: root, encoding: "utf8" }), /mutation=false/);
});
