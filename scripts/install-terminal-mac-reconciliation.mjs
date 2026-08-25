import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, "src", "governed-connector.js");
let source = fs.readFileSync(target, "utf8");

const manifestImport = 'import { getCapabilityManifest } from "./capability-manifest.js";';
if (!source.includes(manifestImport)) {
  const anchor = 'import { crawlWebsite, pageSpeed, getApplicationFunnel, seoIntegrationStatus, websiteControlStatus } from "./integrations/seo-ops.js";';
  if (!source.includes(anchor)) throw new Error("TERMINAL_RECONCILIATION_MANIFEST_IMPORT_ANCHOR_NOT_FOUND");
  source = source.replace(anchor, `${anchor}\n${manifestImport}`);
}

const developerStart = source.indexOf('  if (route.capability.startsWith("developer.")) {');
const developerEnd = source.indexOf('\n  if (route.capability === "sierra.mailbox_evidence.project")', developerStart);
if (developerStart < 0 || developerEnd < 0) throw new Error("TERMINAL_RECONCILIATION_DEVELOPER_BLOCK_NOT_FOUND");
let developerBlock = source.slice(developerStart, developerEnd);

const oldReturn = '    const job = await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk, reason, idempotencyKey: `connector:${command.id}:${route.operation}`, maxAttempts: 1 });\n    return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, dispatchReceipt: job.dispatchReceipt } };';
const newReturn = `    const job = await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk, reason, idempotencyKey: \`connector:\${command.id}:\${route.operation}\`, maxAttempts: 1 });\n    const jobView = { id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, claimedAt: job.claimedAt || null, completedAt: job.completedAt || null, dispatchReceipt: job.dispatchReceipt };\n    if (job.status === "completed") {\n      const manifest = getCapabilityManifest();\n      const actualRuntime = clean(manifest?.sessionRuntime?.unifiedOperatingRuntime, 160) || null;\n      const commandRuntimeMatch = String(command.command || "").match(/unified-georgie-runtime\\.v[a-z0-9._-]+/i);\n      const requiredRuntime = clean(command.metadata?.required_live_manifest || command.metadata?.requiredLiveManifest || commandRuntimeMatch?.[0], 160) || null;\n      const liveManifestVerification = { required: requiredRuntime, actual: actualRuntime, verified: requiredRuntime ? actualRuntime === requiredRuntime : Boolean(actualRuntime), checkedAt: now(), source: "server_live_capability_manifest" };\n      const boundedJob = summarizeGovernedMacJob(job);\n      if (!liveManifestVerification.verified) {\n        return { terminalState: "blocked", completed: true, route, job: jobView, repositoryInspection: boundedJob.repositoryInspection, liveManifestVerification, evidence: [{ type: "mac_job_completion", job: boundedJob }, { type: "live_capability_manifest", ...liveManifestVerification }], productionMutation: false, mailboxMutation: false, error: "LIVE_CAPABILITY_MANIFEST_VERIFICATION_FAILED" };\n      }\n      return { terminalState: "completed", completed: true, route, job: jobView, repositoryInspection: boundedJob.repositoryInspection, liveManifestVerification, evidence: [{ type: "mac_job_completion", job: boundedJob }, { type: "live_capability_manifest", ...liveManifestVerification }], productionMutation: false, mailboxMutation: false };\n    }\n    if (["failed", "dead_letter"].includes(job.status)) {\n      return { terminalState: "blocked", completed: true, route, job: jobView, evidence: [{ type: "mac_job_terminal_failure", job: summarizeGovernedMacJob(job) }], productionMutation: false, mailboxMutation: false, error: clean(job.error || job.status, 1000) };\n    }\n    return { terminalState: "in_progress", completed: false, route, job: jobView };`;

if (!developerBlock.includes("liveManifestVerification")) {
  if (!developerBlock.includes(oldReturn)) throw new Error("TERMINAL_RECONCILIATION_DEVELOPER_RETURN_ANCHOR_NOT_FOUND");
  developerBlock = developerBlock.replace(oldReturn, newReturn);
  source = source.slice(0, developerStart) + developerBlock + source.slice(developerEnd);
}

const recoveringAnchor = 'if(result?.completed===false||["in_progress","working","recovering","queued","running"].includes(terminalState)){const receipt=await record(userId,command,"recovering",{...evidence,error:clean(result?.error||result?.exactBlocker||terminalState,1000)},claim);await transition(userId,command.operatingNodeId,{status:"recovering",recovery:"Resume this same command and lease checkpoint; do not create a duplicate.",nextAction:"Continue from the durable lease checkpoint."}).catch(()=>{});return{commandId:command.id,objectiveId:command.objectiveId,status:"recovering",result,receipt,lease:await readLease(userId,command.id)};}';
const recoveringReplacement = 'if(result?.completed===false||["in_progress","working","recovering","queued","running"].includes(terminalState)){const receipt=await record(userId,command,"recovering",{...evidence,error:clean(result?.error||result?.exactBlocker||terminalState,1000)},claim);await transition(userId,command.operatingNodeId,{status:"recovering",recovery:"Resume this same command and lease checkpoint; do not create a duplicate.",nextAction:"Continue from the durable lease checkpoint."}).catch(()=>{});if(command.routing&&(result?.job||result?.jobs)){const timer=setTimeout(()=>schedule(userId,command),1000);timer.unref?.();}return{commandId:command.id,objectiveId:command.objectiveId,status:"recovering",result,receipt,lease:await readLease(userId,command.id)};}';
if (!source.includes('const timer=setTimeout(()=>schedule(userId,command),1000)')) {
  if (!source.includes(recoveringAnchor)) throw new Error("TERMINAL_RECONCILIATION_RECOVERY_ANCHOR_NOT_FOUND");
  source = source.replace(recoveringAnchor, recoveringReplacement);
}

fs.writeFileSync(target, source);
const finalSource = fs.readFileSync(target, "utf8");
for (const marker of [manifestImport, "liveManifestVerification", "server_live_capability_manifest", "const timer=setTimeout(()=>schedule(userId,command),1000)"]) {
  if (!finalSource.includes(marker)) throw new Error(`TERMINAL_RECONCILIATION_VERIFICATION_FAILED:${marker}`);
}
console.log("[Georgie] terminal Mac reconciliation + live manifest verification installed");
