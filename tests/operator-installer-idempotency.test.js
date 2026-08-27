import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const installer = path.join(root, "scripts/install-operator-reliability-v2.mjs");
const files = ["src/objective-worker.js", "src/memory.js", "src/evaluation.js"];

async function digest(directory) {
  const hash = crypto.createHash("sha256");
  for (const file of files) hash.update(await fs.readFile(path.join(directory, file)));
  return hash.digest("hex");
}

test("operator reliability installer converges after one materialization", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "georgie-installer-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, "src"));
  for (const file of files) await fs.copyFile(path.join(root, file), path.join(directory, file));
  await run(process.execPath, [installer], { cwd: directory });
  const first = await digest(directory);
  await run(process.execPath, [installer], { cwd: directory });
  assert.equal(await digest(directory), first);
});
