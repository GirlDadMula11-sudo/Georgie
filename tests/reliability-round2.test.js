import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reliabilityFastResponse } from "../src/reliability-fast-paths.js";

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");

test("direct answer is immediate and useful",()=>{
 const result=reliabilityFastResponse("Can you answer this immediately without creating a long-running task?");
 assert.equal(result?.completed,true);
 assert.ok(result.text.length>60);
 assert.match(result.text,/ordinary questions immediately/i);
});

test("Sierra completion policy uses bounded deterministic response",()=>{
 const result=reliabilityFastResponse("In Sierra operations, what should be checked before calling a funding file complete?");
 assert.equal(result?.completed,true);
 assert.equal(result?.route?.domain,"sierra");
 assert.match(result.text,/actual funding evidence/i);
 assert.match(result.text,/reconciled/i);
});

test("domain-aware and round2 installers are idempotent in sequence",()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"georgie-installer-order-"));
 try{
  for(const dir of ["src","public","scripts"]){fs.cpSync(path.join(repoRoot,dir),path.join(temp,dir),{recursive:true});}
  const run=(script)=>execFileSync(process.execPath,[script],{cwd:temp,stdio:"pipe"});
  run("scripts/install-domain-aware-chat-runtime.mjs");
  run("scripts/install-reliability-round2.mjs");
  run("scripts/install-domain-aware-chat-runtime.mjs");
  run("scripts/install-reliability-round2.mjs");
  execFileSync(process.execPath,["--check","src/v2-turn-engine.js"],{cwd:temp,stdio:"pipe"});
  const source=fs.readFileSync(path.join(temp,"src/v2-turn-engine.js"),"utf8");
  assert.equal(source.split("const quickInvestment=investmentDirectResponse(input,history);").length-1,1);
  assert.equal(source.split("const reliabilityFast=reliabilityFastResponse(input);").length-1,1);
 }finally{
  fs.rmSync(temp,{recursive:true,force:true});
 }
});
