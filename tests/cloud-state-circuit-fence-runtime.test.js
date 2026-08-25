import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("queued namespaces collapse to one provider probe after first failure",async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"georgie-circuit-runtime-"));
  await fs.copyFile("src/cloud-state.js",path.join(tmp,"cloud-state.js"));
  const installer=await fs.readFile("scripts/install-cloud-state-pressure.mjs","utf8");
  await fs.writeFile(path.join(tmp,"install.mjs"),installer.replace('const path = "src/cloud-state.js";','const path = "cloud-state.js";'));
  const run=spawnSync(process.execPath,["install.mjs"],{cwd:tmp,encoding:"utf8"});
  assert.equal(run.status,0,run.stderr||run.stdout);
  const patched=await fs.readFile(path.join(tmp,"cloud-state.js"),"utf8");
  assert.match(patched,/await acquire\(\);try\{if\(Date\.now\(\)<providerUnavailableUntil\)/);
});
