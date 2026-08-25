import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const installers = [
  "mac-agent/bootstrap.sh",
  "mac-agent/install.sh",
  "native-mac/install-native.sh"
];

test("every Mac installer is committed as an executable entry point", async () => {
  for (const installer of installers) {
    const metadata = await stat(new URL(`../${installer}`, import.meta.url));
    assert.notEqual(metadata.mode & 0o111, 0, `${installer} must be executable`);
  }
});

test("Mac installer recovers stale LaunchAgent registrations without sudo", async () => {
  const installer = await readFile(new URL("../mac-agent/install.sh", import.meta.url), "utf8");
  assert.match(installer, /if \[ -z "\$\{ZSH_VERSION:-\}" \]; then exec \/bin\/zsh "\$0" "\$@"; fi/);
  assert.match(installer, /mac-agent\/\.install-diagnostic\.json/);
  assert.match(installer, /CURRENT_STEP/);
  assert.match(installer, /GEORGIE_NODE_BINARY/);
  assert.match(installer, /Checking Node\.js runtime/);
  assert.match(installer, /PlistBuddy -c "Print :ProgramArguments:0"/);
  assert.match(installer, /\[\[ -x "\$PLIST_NODE" \]\]/);
  assert.match(installer, /write_diagnostic "failed"/);
  assert.doesNotMatch(installer, /tail .*INSTALL_LOG/);
  assert.match(installer, /launchctl bootout "\$SERVICE_TARGET"/);
  assert.match(installer, /launchctl bootout "\$GUI_DOMAIN" "\$PLIST"/);
  assert.match(installer, /launchctl print "\$SERVICE_TARGET"/);
  assert.match(installer, /Do not run this installer with sudo/);
});

test("Mac agent uses single-flight polling, bounded backoff, and safe network diagnostics", async () => {
  const agent = await readFile(new URL("../mac-agent/agent.js", import.meta.url), "utf8");
  assert.doesNotMatch(agent, /setInterval\(cycle/);
  assert.match(agent, /async function runForever/);
  assert.match(agent, /MAX_BACKOFF/);
  assert.match(agent, /mac_agent_connection_failed/);
  assert.match(agent, /spawn\("\/bin\/zsh", \[installer\]/);
  assert.match(agent, /GEORGIE_NODE_BINARY: process\.execPath/);
  assert.match(agent, /serverOrigin: new URL\(BASE\)\.origin/);
  assert.doesNotMatch(agent, /Authorization.*console\.(?:log|error)/);
});
