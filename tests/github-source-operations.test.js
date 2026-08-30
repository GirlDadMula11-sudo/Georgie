import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getBranch, getRepository, readFile, createBranch, githubSourceConfigured, listHandoffIssues, commentHandoffIssue } from "../src/integrations/github-source.js";

function withFetch(mock, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = original; });
}
function jsonResponse(status, payload) {
  return { status, async text() { return JSON.stringify(payload); } };
}

test("server-side GitHub adapter uses configured credential and returns exact branch SHA", async () => {
  const old = process.env.GEORGIE_GITHUB_TOKEN;
  process.env.GEORGIE_GITHUB_TOKEN = "test-token";
  try {
    await withFetch(async (url, options) => {
      assert.match(String(url), /GirlDadMula11-sudo\/Sierra-Partner-Portal\/branches\/main$/);
      assert.equal(options.headers.authorization, "Bearer test-token");
      return jsonResponse(200, { name: "main", commit: { sha: "abc123" }, protected: true });
    }, async () => {
      const result = await getBranch("GirlDadMula11-sudo/Sierra-Partner-Portal", "main");
      assert.deepEqual(result, { ok: true, branch: { name: "main", sha: "abc123", protected: true } });
    });
  } finally { if (old === undefined) delete process.env.GEORGIE_GITHUB_TOKEN; else process.env.GEORGIE_GITHUB_TOKEN = old; }
});

test("private repository 404 remains typed not_found and never falls back", async () => {
  const old = process.env.GEORGIE_GITHUB_TOKEN;
  process.env.GEORGIE_GITHUB_TOKEN = "test-token";
  try {
    let calls = 0;
    await withFetch(async () => { calls += 1; return jsonResponse(404, { message: "Not Found" }); }, async () => {
      const result = await getRepository("GirlDadMula11-sudo/Sierra-Partner-Portal");
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "not_found");
      assert.equal(calls, 1);
    });
  } finally { if (old === undefined) delete process.env.GEORGIE_GITHUB_TOKEN; else process.env.GEORGIE_GITHUB_TOKEN = old; }
});

test("secret paths are denied before provider access", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch must not run"); };
  try {
    const result = await readFile("GirlDadMula11-sudo/Georgie", ".env", "main");
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "permission_denied");
  } finally { globalThis.fetch = original; }
});

test("GitHub source mutations stay approval-gated in tool registry", () => {
  const source = fs.readFileSync(new URL("../src/tools.js", import.meta.url), "utf8");
  for (const name of ["github.branch.create", "github.commit.create", "github.pull_request.create"]) {
    const at = source.indexOf(`name:\"${name}\"`);
    assert.ok(at >= 0, `${name} must be registered`);
    assert.match(source.slice(at, at + 500), /risk:\"sensitive_write\"/);
  }
  for (const name of ["github.repository.list", "github.repository.get", "github.branch.list", "github.branch.get", "github.file.read", "github.source.search"]) {
    const at = source.indexOf(`name:\"${name}\"`);
    assert.ok(at >= 0, `${name} must be registered`);
    assert.match(source.slice(at, at + 500), /risk:\"read\"/);
  }
  assert.equal(source.includes('name:"github.repository.list"') && source.includes('queueMacAndWait(userId,args,"github.'), false, "GitHub source tools must not use Mac queue");
});

test("branch creation uses server-side GitHub ref API", async () => {
  const old = process.env.GEORGIE_GITHUB_TOKEN;
  process.env.GEORGIE_GITHUB_TOKEN = "test-token";
  try {
    const calls = [];
    await withFetch(async (url, options) => {
      calls.push({ url: String(url), method: options.method, body: options.body });
      if (String(url).endsWith("/branches/main")) return jsonResponse(200, { name: "main", commit: { sha: "base-sha" }, protected: false });
      return jsonResponse(201, { ref: "refs/heads/fix/test", object: { sha: "base-sha" } });
    }, async () => {
      const result = await createBranch("GirlDadMula11-sudo/Georgie", "fix/test", "main");
      assert.equal(result.ok, true);
      assert.equal(calls.length, 2);
      assert.match(calls[1].url, /\/git\/refs$/);
      assert.equal(calls[1].method, "POST");
    });
  } finally { if (old === undefined) delete process.env.GEORGIE_GITHUB_TOKEN; else process.env.GEORGIE_GITHUB_TOKEN = old; }
});

test("configuration truth reflects server credential only", () => {
  const oldA = process.env.GEORGIE_GITHUB_TOKEN;
  const oldB = process.env.GITHUB_TOKEN;
  delete process.env.GEORGIE_GITHUB_TOKEN; delete process.env.GITHUB_TOKEN;
  assert.equal(githubSourceConfigured(), false);
  process.env.GEORGIE_GITHUB_TOKEN = "x";
  assert.equal(githubSourceConfigured(), true);
  if (oldA === undefined) delete process.env.GEORGIE_GITHUB_TOKEN; else process.env.GEORGIE_GITHUB_TOKEN = oldA;
  if (oldB === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldB;
});

test("assistant handoff inbox imports only labeled issues and excludes pull requests", async () => {
  const old = process.env.GEORGIE_GITHUB_TOKEN;
  process.env.GEORGIE_GITHUB_TOKEN = "test-token";
  try {
    await withFetch(async (url) => {
      assert.match(String(url), /issues\?state=open&labels=georgie-handoff/);
      return jsonResponse(200, [
        { number: 7, title: "Verify queue recovery", body: "Evidence and acceptance criteria", updated_at: "2026-08-22T20:00:00Z", html_url: "https://github.test/issues/7" },
        { number: 8, title: "A pull request", pull_request: { url: "x" } }
      ]);
    }, async () => {
      const result = await listHandoffIssues();
      assert.equal(result.ok, true);
      assert.equal(result.issues.length, 1);
      assert.equal(result.issues[0].number, 7);
    });
  } finally { if (old === undefined) delete process.env.GEORGIE_GITHUB_TOKEN; else process.env.GEORGIE_GITHUB_TOKEN = old; }
});

test("Georgie can return a bounded durable receipt to the same handoff issue", async () => {
  const old = process.env.GEORGIE_GITHUB_TOKEN;
  process.env.GEORGIE_GITHUB_TOKEN = "test-token";
  try {
    let posted=null;
    await withFetch(async (url,options)=>{
      assert.match(String(url),/\/issues\/7\/comments/);
      if(options.method==="GET")return jsonResponse(200,[]);
      posted=JSON.parse(options.body);
      return jsonResponse(201,{id:99,html_url:"https://github.test/issues/7#comment-99"});
    },async()=>{
      const result=await commentHandoffIssue("GirlDadMula11-sudo/Georgie",7,{body:"Verified queue recovery.",receiptKey:"handoff-1:completed"});
      assert.equal(result.ok,true);
      assert.match(posted.body,/Verified queue recovery/);
      assert.match(posted.body,/georgie-receipt:handoff-1:completed/);
    });
  } finally { if (old === undefined) delete process.env.GEORGIE_GITHUB_TOKEN; else process.env.GEORGIE_GITHUB_TOKEN = old; }
});

test("Georgie receipt replay returns the existing marker with zero duplicate post",async()=>{
  const old=process.env.GEORGIE_GITHUB_TOKEN;process.env.GEORGIE_GITHUB_TOKEN="test-token";let posts=0;
  try{await withFetch(async(_url,options)=>{if(options.method==="POST")posts+=1;return jsonResponse(200,[{id:99,html_url:"https://github.test/issues/7#comment-99",body:"<!-- georgie-receipt:handoff-1:completed -->"}]);},async()=>{
    const result=await commentHandoffIssue("GirlDadMula11-sudo/Georgie",7,{body:"Verified queue recovery.",receiptKey:"handoff-1:completed"});
    assert.equal(result.ok,true);assert.equal(result.duplicate,true);assert.equal(posts,0);
  });}finally{if(old===undefined)delete process.env.GEORGIE_GITHUB_TOKEN;else process.env.GEORGIE_GITHUB_TOKEN=old;}
});
