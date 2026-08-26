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
const modernBoundedRecovery = governed.includes("function scheduleRecovery(userId,command,lease)")
  && governed.includes('if(outcome?.status==="recovering")scheduleRecovery(userId,command,outcome.lease)')
  && governed.includes("boundedRecoveryMaxAttempts");
if (governed.includes('.slice(0,12),scheduled=[]')) governed = governed.replace('.slice(0,12),scheduled=[]', '.slice(0,2),scheduled=[]');
else if (governed.includes('.slice(0,3),scheduled=[]')) governed = governed.replace('.slice(0,3),scheduled=[]', '.slice(0,2),scheduled=[]');

const enqueueAnchor = '    const enqueuedJob = await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk, reason, idempotencyKey: `connector:${command.id}:${route.operation}`, maxAttempts: 1 });\n    const authoritativeJob = (await listMacJobs(userId, 500)).find(item => item.id === enqueuedJob.id) || enqueuedJob;';
const recoveryFastPath = '    const existingJobId = clean(command.result?.job?.id || command.metadata?.existing_job_id || command.metadata?.existingJobId, 200);\n    const existingJob = existingJobId ? (await listMacJobs(userId, 500)).find(item => item.id === existingJobId) : null;\n    const enqueuedJob = existingJob || await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk, reason, idempotencyKey: `connector:${command.id}:${route.operation}`, maxAttempts: 1 });\n    const authoritativeJob = existingJob || (await listMacJobs(userId, 500)).find(item => item.id === enqueuedJob.id) || enqueuedJob;';
if (!governed.includes('const existingJobId = clean(command.result?.job?.id')) {
  if (!governed.includes(enqueueAnchor)) throw new Error("CONNECTOR_RECOVERY_FAST_PATH_ANCHOR_NOT_FOUND");
  governed = governed.replace(enqueueAnchor, recoveryFastPath);
}
fs.writeFileSync(governedTarget, governed);

const finalSource = fs.readFileSync(target, "utf8");
for (const marker of ["resumePendingConnectorWork", "connectorRecoveryTimer=setInterval", "connector.resume(userId)", "45000", "connectorRecoveryTimer.unref?.()"] ) {
  if (!finalSource.includes(marker)) throw new Error(`CONNECTOR_RECOVERY_SUPERVISOR_VERIFY_FAILED:${marker}`);
}
const finalGoverned = fs.readFileSync(governedTarget, "utf8");
const governedMarkers = ['const existingJobId = clean(command.result?.job?.id', 'const enqueuedJob = existingJob || await enqueueMacJob'];
if (!modernBoundedRecovery) governedMarkers.unshift('.slice(0,2),scheduled=[]');
for (const marker of governedMarkers) {
  if (!finalGoverned.includes(marker)) throw new Error(`CONNECTOR_RECOVERY_SUPERVISOR_GOVERNED_VERIFY_FAILED:${marker}`);
}
if (modernBoundedRecovery && !finalGoverned.includes("boundedRecoveryMaxAttempts")) throw new Error("CONNECTOR_RECOVERY_SUPERVISOR_BOUNDED_RECOVERY_MISSING");
console.log(`[Georgie] persistent connector recovery supervisor installed: batch=${modernBoundedRecovery ? "bounded" : "2"} interval=45s completed-child-fast-path=true`);
