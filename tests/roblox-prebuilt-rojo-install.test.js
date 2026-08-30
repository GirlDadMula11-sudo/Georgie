import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const agent = await fs.readFile(new URL("../mac-agent/agent.js", import.meta.url), "utf8");

test("Rojo recovery pins the official Intel macOS release and both checksums", () => {
  assert.match(agent, /version: "7\.7\.0"/);
  assert.match(agent, /https:\/\/github\.com\/rojo-rbx\/rojo\/releases\/download\/v7\.7\.0\/rojo-7\.7\.0-macos-x86_64\.zip/);
  assert.match(agent, /archiveSha256: "9bd69697ca3a0abf0ec847c779013e7315501b2d997d63d5e1766e14d49d9c66"/);
  assert.match(agent, /binarySha256: "571e186637ddac6961e97e5b744f8fec33c3ef02fa77ba9fa2e63c2ad3b5f2a8"/);
  assert.match(agent, /ROJO_ARCHIVE_CHECKSUM_MISMATCH/);
  assert.match(agent, /ROJO_BINARY_CHECKSUM_MISMATCH/);
  assert.match(agent, /version === `Rojo \$\{ROJO_RELEASE\.version\}`/);
});

test("Rojo recovery bypasses Homebrew and installs atomically in the user path", () => {
  const action = agent.slice(agent.indexOf('case "roblox.install_rojo_and_build"'), agent.indexOf('case "roblox.prototype_build"'));
  assert.doesNotMatch(action, /brew|HOMEBREW/i);
  assert.match(agent, /path\.join\(os\.homedir\(\), "\.local", "bin", "rojo"\)/);
  assert.match(agent, /await fs\.rename\(staged, target\)/);
  assert.match(action, /installPinnedRojo\(\)/);
});
