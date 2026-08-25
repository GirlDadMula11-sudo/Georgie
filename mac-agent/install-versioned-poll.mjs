import fs from "node:fs";
import path from "node:path";

const target = path.resolve("mac-agent/agent.js");
let source = fs.readFileSync(target, "utf8");

const legacy = 'const payload = await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs?limit=5`);';
const repaired = 'const payload = await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs?limit=5&agentVersion=${encodeURIComponent(AGENT_VERSION)}`);';

if (source.includes(legacy)) {
  source = source.replace(legacy, repaired);
} else if (!source.includes(repaired)) {
  throw new Error("MAC_VERSIONED_POLL_ANCHOR_NOT_FOUND");
}

fs.writeFileSync(target, source);
const verify = fs.readFileSync(target, "utf8");
if (!verify.includes("agentVersion=${encodeURIComponent(AGENT_VERSION)}")) {
  throw new Error("MAC_VERSIONED_POLL_VERIFY_FAILED");
}
console.log("[Georgie] Mac poll now advertises agentVersion on every claim request");
