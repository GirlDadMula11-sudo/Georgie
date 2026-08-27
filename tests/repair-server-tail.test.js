import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const serverPath = new URL("../src/server.js", import.meta.url);
const repairPath = new URL("../scripts/repair-server-tail.mjs", import.meta.url);
const digest = value => createHash("sha256").update(value).digest("hex");

test("startup tail repair preserves a healthy governed connector registration", async () => {
  const before = await readFile(serverPath, "utf8");
  assert.match(before, /app\.use\("\/mcp",createPortableMcpRouter/);
  assert.doesNotMatch(before, /^start[A-Z][A-Za-z0-9]*\(\);$/m);

  const result = spawnSync(process.execPath, [repairPath.pathname], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preserving all registered routes and workers/);

  const after = await readFile(serverPath, "utf8");
  assert.equal(digest(after), digest(before));
  assert.match(after, /app\.use\("\/mcp",createPortableMcpRouter/);
  assert.doesNotMatch(after, /^start[A-Z][A-Za-z0-9]*\(\);$/m);
});

test("v2 activation preserves connector routes registered after completeTurn", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "georgie-tail-repair-"));
  try {
    await mkdir(path.join(root, "src", "integrations"), { recursive: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    const source = (await readFile(serverPath, "utf8")).replaceAll('engine:"v2-concurrent"', 'engine:"legacy-test"');
    const repair = await readFile(repairPath, "utf8");
    await writeFile(path.join(root, "src", "server.js"), source);
    await writeFile(path.join(root, "scripts", "repair-server-tail.mjs"), repair);

    const result = spawnSync(process.execPath, [path.join(root, "scripts", "repair-server-tail.mjs")], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);

    const repaired = await readFile(path.join(root, "src", "server.js"), "utf8");
    assert.match(repaired, /app\.use\("\/api\/connector",createGovernedConnectorRouter/);
    assert.match(repaired, /app\.use\("\/mcp",createPortableMcpRouter/);
    assert.match(repaired, /app\.get\("\/health"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
