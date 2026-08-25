import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, "src", "portable-connector-mcp.js");
let source = fs.readFileSync(target, "utf8");

const startupOnly = 'setImmediate(() => connector.resume(userId).catch(error => console.error("[Georgie] connector startup resume failed:", error instanceof Error ? error.message : error)));';
const supervised = 'const resumePendingConnectorWork=()=>connector.resume(userId).catch(error=>console.error("[Georgie] connector recovery supervisor failed:",error instanceof Error?error.message:error)); setImmediate(resumePendingConnectorWork); const connectorRecoveryTimer=setInterval(resumePendingConnectorWork,45000); connectorRecoveryTimer.unref?.();';

if (!source.includes("connectorRecoveryTimer=setInterval")) {
  if (!source.includes(startupOnly)) throw new Error("CONNECTOR_RECOVERY_SUPERVISOR_STARTUP_ANCHOR_NOT_FOUND");
  source = source.replace(startupOnly, supervised);
  fs.writeFileSync(target, source);
}

const governedTarget = path.join(root, "src", "governed-connector.js");
let governed = fs.readFileSync(governedTarget, "utf8");
if (governed.includes('.slice(0,12),scheduled=[]')) governed = governed.replace('.slice(0,12),scheduled=[]', '.slice(0,2),scheduled=[]');
else if (governed.includes('.slice(0,3),scheduled=[]')) governed = governed.replace('.slice(0,3),scheduled=[]', '.slice(0,2),scheduled=[]');
fs.writeFileSync(governedTarget, governed);

const finalSource = fs.readFileSync(target, "utf8");
for (const marker of ["resumePendingConnectorWork", "connectorRecoveryTimer=setInterval", "connector.resume(userId)", "45000", "connectorRecoveryTimer.unref?.()"] ) {
  if (!finalSource.includes(marker)) throw new Error(`CONNECTOR_RECOVERY_SUPERVISOR_VERIFY_FAILED:${marker}`);
}
const finalGoverned = fs.readFileSync(governedTarget, "utf8");
if (!finalGoverned.includes('.slice(0,2),scheduled=[]')) throw new Error("CONNECTOR_RECOVERY_SUPERVISOR_CONCURRENCY_VERIFY_FAILED");
console.log("[Georgie] persistent connector recovery supervisor installed: batch=2 interval=45s");
