import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync=promisify(execFile);

test("slow cloud memory cannot hold an ordinary foreground read for six seconds", async () => {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),"georgie-phase4-memory-"));
  try{
    const program=`
      globalThis.fetch=(_url,{signal}={})=>new Promise((_resolve,reject)=>{const keepalive=setTimeout(()=>reject(new Error("mock provider exceeded guard")),1000);signal?.addEventListener("abort",()=>{clearTimeout(keepalive);reject(signal.reason);},{once:true});});
      const memory=await import("./src/memory.js");
      const started=Date.now();
      const history=await memory.getSessionHistory("phase4","ordinary",12);
      console.log(JSON.stringify({history,elapsed:Date.now()-started,status:memory.getMemoryStorageStatus()}));
    `;
    const {stdout}=await execFileAsync(process.execPath,["--input-type=module","-e",program],{cwd:process.cwd(),env:{...process.env,GEORGIE_SUPABASE_URL:"https://memory.invalid",GEORGIE_SUPABASE_SERVICE_ROLE_KEY:"test-only",GEORGIE_MEMORY_READ_TIMEOUT_MS:"40",GEORGIE_DATA_DIR:dataDir},timeout:2000});
    const result=JSON.parse(stdout.trim().split("\n").at(-1));
    assert.deepEqual(result.history,[]);
    assert.ok(result.elapsed>=25&&result.elapsed<250,`foreground fallback took ${result.elapsed}ms`);
    assert.equal(result.status.foregroundReadBudgetMs,40);
    assert.equal(result.status.localMirror,true);
  }finally{
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});

test("memory exposes a bounded default foreground budget and a durable local mirror", async () => {
  const memory=await import(`../src/memory.js?phase4-default=${Date.now()}`);
  const status=memory.getMemoryStorageStatus();
  assert.ok(status.foregroundReadBudgetMs<=1500);
  assert.ok(status.backgroundWriteBudgetMs>=500);
  assert.equal(status.localMirror,true);
});
