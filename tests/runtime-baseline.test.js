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

test("normal runtime never launches the emergency mailbox backfill", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.start, "node src/runtime.js");
  assert.equal(pkg.scripts["maintenance:neo-backfill"], "node scripts/emergency-neo-mailbox-backfill.mjs");
  for (const name of ["start", "prestart", "dev", "check"]) assert.doesNotMatch(pkg.scripts[name], /(?:^|&& )node scripts\/emergency-neo-mailbox-backfill/);
});
