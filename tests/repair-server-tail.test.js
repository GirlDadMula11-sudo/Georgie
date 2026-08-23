import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const serverPath = new URL("../src/server.js", import.meta.url);
const repairPath = new URL("../scripts/repair-server-tail.mjs", import.meta.url);
const digest = value => createHash("sha256").update(value).digest("hex");

test("startup tail repair preserves a healthy governed connector registration", async () => {
  const before = await readFile(serverPath, "utf8");
  assert.match(before, /app\.use\("\/mcp",createPortableMcpRouter/);
  assert.match(before, /startEngineeringCoordinator\(\)/);

  const result = spawnSync(process.execPath, [repairPath.pathname], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preserving all registered routes and workers/);

  const after = await readFile(serverPath, "utf8");
  assert.equal(digest(after), digest(before));
  assert.match(after, /app\.use\("\/mcp",createPortableMcpRouter/);
  assert.match(after, /startEngineeringCoordinator\(\)/);
});
