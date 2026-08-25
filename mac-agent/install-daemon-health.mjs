import fs from "node:fs";
import path from "node:path";

const target = path.resolve("mac-agent/agent.js");
let source = fs.readFileSync(target, "utf8");

const versionOld = 'const AGENT_VERSION = "2.2.32";';
const versionNew = 'const AGENT_VERSION = "2.2.33";';
if (source.includes(versionOld)) source = source.replace(versionOld, versionNew);
else if (!source.includes(versionNew)) throw new Error("MAC_DAEMON_HEALTH_VERSION_ANCHOR_NOT_FOUND");

const maxBackoffAnchor = 'const MAX_BACKOFF = Math.max(INTERVAL, Number(process.env.GEORGIE_MAC_MAX_BACKOFF_MS || 30000));';
const healthBlock = `${maxBackoffAnchor}\nconst HEALTH_DIR = path.join(os.homedir(), "Library", "Application Support", "Georgie");\nconst HEALTH_FILE = path.join(HEALTH_DIR, "mac-agent-health.json");\nasync function writeDaemonHealth(extra = {}) {\n  await fs.mkdir(HEALTH_DIR, { recursive: true, mode: 0o700 });\n  const payload = { deviceId: DEVICE_ID, agentVersion: AGENT_VERSION, pid: process.pid, serverOrigin: new URL(BASE).origin, successfulCycleAt: new Date().toISOString(), ...extra };\n  const temp = `${'${'}HEALTH_FILE}.${'${'}process.pid}.tmp`;\n  await fs.writeFile(temp, JSON.stringify(payload), { mode: 0o600 });\n  await fs.rename(temp, HEALTH_FILE);\n}`;
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
for (const marker of ["2.2.33", "mac-agent-health.json", "lastPollOk: true"]) {
  if (!verify.includes(marker)) throw new Error(`MAC_DAEMON_HEALTH_VERIFY_FAILED:${marker}`);
}
console.log("[Georgie] daemon-owned Mac polling health receipt installed");
