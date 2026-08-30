import fs from "node:fs";
import path from "node:path";

const target = path.resolve("mac-agent/agent.js");
let source = fs.readFileSync(target, "utf8");

const versionMatch = source.match(/const AGENT_VERSION = "(\d+\.\d+\.\d+)";/);
if (!versionMatch) throw new Error("MAC_DAEMON_HEALTH_VERSION_ANCHOR_NOT_FOUND");
const sourceAgentVersion = versionMatch[1];

const maxBackoffAnchor = 'const MAX_BACKOFF = Math.max(INTERVAL, Number(process.env.GEORGIE_MAC_MAX_BACKOFF_MS || 30000));';
const healthBlock = [
  maxBackoffAnchor,
  'const HEALTH_DIR = path.join(os.homedir(), "Library", "Application Support", "Georgie");',
  'const HEALTH_FILE = path.join(HEALTH_DIR, "mac-agent-health.json");',
  'async function writeDaemonHealth(extra = {}) {',
  '  await fs.mkdir(HEALTH_DIR, { recursive: true, mode: 0o700 });',
  '  const payload = { deviceId: DEVICE_ID, agentVersion: AGENT_VERSION, pid: process.pid, serverOrigin: new URL(BASE).origin, successfulCycleAt: new Date().toISOString(), ...extra };',
  '  const temp = HEALTH_FILE + "." + process.pid + ".tmp";',
  '  await fs.writeFile(temp, JSON.stringify(payload), { mode: 0o600 });',
  '  await fs.rename(temp, HEALTH_FILE);',
  '}'
].join("\n");
if (!source.includes("const HEALTH_FILE =")) {
  if (!source.includes(maxBackoffAnchor)) throw new Error("MAC_DAEMON_HEALTH_BACKOFF_ANCHOR_NOT_FOUND");
  source = source.replace(maxBackoffAnchor, healthBlock);
}

const successAnchor = '    return true;\n  } catch (error) {';
const successReplacement = '    await writeDaemonHealth({ lastPollOk: true });\n    return true;\n  } catch (error) {';
if (!source.includes("lastPollOk: true")) {
  if (!source.includes(successAnchor)) throw new Error("MAC_DAEMON_HEALTH_CYCLE_ANCHOR_NOT_FOUND");
  source = source.replace(successAnchor, successReplacement);
}

fs.writeFileSync(target, source);
const verify = fs.readFileSync(target, "utf8");
for (const marker of [`const AGENT_VERSION = "${sourceAgentVersion}";`, "mac-agent-health.json", "lastPollOk: true", 'const temp = HEALTH_FILE + "." + process.pid + ".tmp";']) {
  if (!verify.includes(marker)) throw new Error(`MAC_DAEMON_HEALTH_VERIFY_FAILED:${marker}`);
}
console.log("[Georgie] daemon-owned Mac polling health receipt installed");
