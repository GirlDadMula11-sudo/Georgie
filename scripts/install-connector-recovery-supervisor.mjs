import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "src", "portable-connector-mcp.js");
let source = fs.readFileSync(target, "utf8");

const startupOnly = 'setImmediate(() => connector.resume(userId).catch(error => console.error("[Georgie] connector startup resume failed:", error instanceof Error ? error.message : error)));';
const supervised = 'const resumePendingConnectorWork=()=>connector.resume(userId).catch(error=>console.error("[Georgie] connector recovery supervisor failed:",error instanceof Error?error.message:error)); setImmediate(resumePendingConnectorWork); const connectorRecoveryTimer=setInterval(resumePendingConnectorWork,15000); connectorRecoveryTimer.unref?.();';

if (!source.includes("connectorRecoveryTimer=setInterval")) {
  if (!source.includes(startupOnly)) throw new Error("CONNECTOR_RECOVERY_SUPERVISOR_STARTUP_ANCHOR_NOT_FOUND");
  source = source.replace(startupOnly, supervised);
  fs.writeFileSync(target, source);
}

const finalSource = fs.readFileSync(target, "utf8");
for (const marker of ["resumePendingConnectorWork", "connectorRecoveryTimer=setInterval", "connector.resume(userId)", "connectorRecoveryTimer.unref?.()"] ) {
  if (!finalSource.includes(marker)) throw new Error(`CONNECTOR_RECOVERY_SUPERVISOR_VERIFY_FAILED:${marker}`);
}
console.log("[Georgie] persistent bounded connector recovery supervisor installed");
