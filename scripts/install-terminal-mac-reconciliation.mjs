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
const newReturn = `    const enqueuedJob = await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk, reason, idempotencyKey: \`connector:\${command.id}:\${route.operation}\`, maxAttempts: 1 });\n    const authoritativeJob = (await listMacJobs(userId, 500)).find(item => item.id === enqueuedJob.id) || enqueuedJob;\n    const jobView = { id: authoritativeJob.id, status: authoritativeJob.status, action: authoritativeJob.action, deviceId: authoritativeJob.deviceId, claimedAt: authoritativeJob.claimedAt || authoritativeJob.dispatchReceipt?.claimedAt || null, completedAt: authoritativeJob.completedAt || null, dispatchReceipt: authoritativeJob.dispatchReceipt };\n    if (authoritativeJob.status === "completed") {\n      const manifest = getCapabilityManifest();\n      const actualRuntime = clean(manifest?.sessionRuntime?.unifiedOperatingRuntime, 160) || null;\n      const commandRuntimeMatch = String(command.command || "").match(/unified-georgie-runtime\\.v[a-z0-9]+(?:-[a-z0-9]+)*/i);\n      const requiredRuntime = clean(command.metadata?.required_live_manifest || command.metadata?.requiredLiveManifest || commandRuntimeMatch?.[0], 160) || null;\n      const liveManifestVerification = { required: requiredRuntime, actual: actualRuntime, verified: requiredRuntime ? actualRuntime === requiredRuntime : Boolean(actualRuntime), checkedAt: now(), source: "server_live_capability_manifest" };\n      const boundedJob = summarizeGovernedMacJob(authoritativeJob);\n      const inspectionResultReturned = Boolean(boundedJob.repositoryInspection || boundedJob.sourceInspection);\n      if (!inspectionResultReturned) return { terminalState: "blocked", completed: true, route, job: jobView, inspectionResultReturned: false, liveManifestVerification, evidence: [{ type: "mac_job_completion_without_inspection_result", job: boundedJob }], productionMutation: false, mailboxMutation: false, error: "MAC_INSPECTION_RESULT_MISSING" };\n      if (!liveManifestVerification.verified) return { terminalState: "blocked", completed: true, route, job: jobView, repositoryInspection: boundedJob.repositoryInspection, sourceInspection: boundedJob.sourceInspection, inspectionResultReturned: true, liveManifestVerification, evidence: [{ type: "mac_job_completion", job: boundedJob }, { type: "live_capability_manifest", ...liveManifestVerification }], productionMutation: false, mailboxMutation: false, error: "LIVE_CAPABILITY_MANIFEST_VERIFICATION_FAILED" };\n      return { terminalState: "completed", completed: true, route, job: jobView, repositoryInspection: boundedJob.repositoryInspection, sourceInspection: boundedJob.sourceInspection, inspectionResultReturned: true, liveManifestVerification, evidence: [{ type: "mac_job_completion", job: boundedJob }, { type: "live_capability_manifest", ...liveManifestVerification }], productionMutation: false, mailboxMutation: false };\n    }\n    if (["failed", "dead_letter"].includes(authoritativeJob.status)) return { terminalState: "blocked", completed: true, route, job: jobView, inspectionResultReturned: false, evidence: [{ type: "mac_job_terminal_failure", job: summarizeGovernedMacJob(authoritativeJob) }], productionMutation: false, mailboxMutation: false, error: clean(authoritativeJob.error || authoritativeJob.status, 1000) };\n    return { terminalState: "in_progress", completed: false, route, job: jobView };`;
if (!developerBlock.includes("authoritativeJob")) {
  if (!developerBlock.includes(oldReturn)) throw new Error("TERMINAL_RECONCILIATION_DEVELOPER_RETURN_ANCHOR_NOT_FOUND");
  developerBlock = developerBlock.replace(oldReturn, newReturn);
  source = source.slice(0, developerStart) + developerBlock + source.slice(developerEnd);
}

const recoveringAnchor = 'if(result?.completed===false||["in_progress","working","recovering","queued","running"].includes(terminalState)){const receipt=await record(userId,command,"recovering",{...evidence,error:clean(result?.error||result?.exactBlocker||terminalState,1000)},claim);await transition(userId,command.operatingNodeId,{status:"recovering",recovery:"Resume this same command and lease checkpoint; do not create a duplicate.",nextAction:"Continue from the durable lease checkpoint."}).catch(()=>{});return{commandId:command.id,objectiveId:command.objectiveId,status:"recovering",result,receipt,lease:await readLease(userId,command.id)};}';
const recoveringReplacement = 'if(result?.completed===false||["in_progress","working","recovering","queued","running"].includes(terminalState)){const receipt=await record(userId,command,"recovering",{...evidence,error:clean(result?.error||result?.exactBlocker||terminalState,1000)},claim);await transition(userId,command.operatingNodeId,{status:"recovering",recovery:"Resume this same command and lease checkpoint; do not create a duplicate.",nextAction:"Continue from the durable lease checkpoint."}).catch(()=>{});if(command.routing&&(result?.job||result?.jobs)){const requeue=()=>{if(!schedule(userId,command)){const retry=setTimeout(requeue,500);retry.unref?.();}};const timer=setTimeout(requeue,1000);timer.unref?.();}return{commandId:command.id,objectiveId:command.objectiveId,status:"recovering",result,receipt,lease:await readLease(userId,command.id)};}';
if (!source.includes('const requeue=()=>{if(!schedule(userId,command))')) {
  if (!source.includes(recoveringAnchor)) throw new Error("TERMINAL_RECONCILIATION_RECOVERY_ANCHOR_NOT_FOUND");
  source = source.replace(recoveringAnchor, recoveringReplacement);
}
const summaryAnchor = 'objectiveStatus:result?.objectiveStatus||null}:{text:';
const summaryReplacement = 'objectiveStatus:result?.objectiveStatus||null,repositoryInspection:result?.repositoryInspection||null,sourceInspection:result?.sourceInspection||null,inspectionResultReturned:result?.inspectionResultReturned===true,liveManifestVerification:result?.liveManifestVerification||null,liveManifestVerified:result?.liveManifestVerification?.verified===true}:{text:';
if (!source.includes('liveManifestVerified:result?.liveManifestVerification?.verified===true')) {
  if (!source.includes(summaryAnchor)) throw new Error("TERMINAL_RECONCILIATION_RESULT_SUMMARY_ANCHOR_NOT_FOUND");
  source = source.replace(summaryAnchor, summaryReplacement);
}
const statusAnchor = 'if(job)response.macJob=summarizeGovernedMacJob(job);response.packetManifests=await listMailboxPacketManifests(userId,{objectiveId:command.objectiveId,limit:25});';
const statusReplacement = 'if(job){response.macJob=summarizeGovernedMacJob(job);if(["completed","failed","dead_letter"].includes(job.status)&&["accepted","running","recovering","failed"].includes(command.status)){schedule(userId,command);response.reconciliationScheduled=true;}}response.packetManifests=await listMailboxPacketManifests(userId,{objectiveId:command.objectiveId,limit:25});';
if (!source.includes('response.reconciliationScheduled=true')) {
  if (!source.includes(statusAnchor)) throw new Error("TERMINAL_RECONCILIATION_STATUS_ANCHOR_NOT_FOUND");
  source = source.replace(statusAnchor, statusReplacement);
}
const resumeAnchor = 'async function resume(userId="primary"){const state=await read(userId),pending=state.commands.filter(row=>["accepted","running","recovering","failed"].includes(row.status)),scheduled=[];for(const command of pending){const lease=leaseFor(state,command.id);if(!activeLease(lease)||lease?.status==="queued"){schedule(userId,command);scheduled.push({commandId:command.id,objectiveId:command.objectiveId});}}return scheduled;}';
const resumeReplacement = 'async function resume(userId="primary"){const state=await read(userId),jobs=await listMacJobs(userId,500),jobById=new Map(jobs.map(job=>[job.id,job])),nowMs=Date.now(),pending=state.commands.filter(row=>["accepted","running","recovering"].includes(row.status)).map(command=>{const child=jobById.get(clean(command.result?.job?.id||command.metadata?.existing_job_id||command.metadata?.existingJobId,200));const terminalChild=Boolean(child&&["completed","failed","dead_letter"].includes(child.status));const certificationGate=Boolean(command.metadata?.required_live_manifest||command.metadata?.requiredLiveManifest||String(command.command||"").includes("unified-georgie-runtime"));const updatedMs=Date.parse(command.updatedAt||command.createdAt||0)||0;return{command,terminalChild,certificationGate,updatedMs};}).filter(item=>item.certificationGate||item.terminalChild||nowMs-item.updatedMs<600000).sort((a,b)=>Number(b.certificationGate)-Number(a.certificationGate)||Number(b.terminalChild)-Number(a.terminalChild)||b.updatedMs-a.updatedMs).slice(0,12),scheduled=[];for(const item of pending){const command=item.command,lease=leaseFor(state,command.id);if(!activeLease(lease)||lease?.status==="queued"){schedule(userId,command);scheduled.push({commandId:command.id,objectiveId:command.objectiveId,terminalChild:item.terminalChild,certificationGate:item.certificationGate});}}return scheduled;}';
if (!source.includes('certificationGate:item.certificationGate')) {
  if (!source.includes(resumeAnchor)) throw new Error("TERMINAL_RECONCILIATION_RESUME_ANCHOR_NOT_FOUND");
  source = source.replace(resumeAnchor, resumeReplacement);
}
fs.writeFileSync(target, source);
const finalSource = fs.readFileSync(target, "utf8");
for (const marker of [manifestImport, "authoritativeJob", "server_live_capability_manifest", "inspectionResultReturned", "liveManifestVerified", "response.reconciliationScheduled=true", "const requeue=()=>{if(!schedule(userId,command)", "item.certificationGate||item.terminalChild", "unified-georgie-runtime\\.v[a-z0-9]+(?:-[a-z0-9]+)*"]) if (!finalSource.includes(marker)) throw new Error(`TERMINAL_RECONCILIATION_VERIFICATION_FAILED:${marker}`);

const portableTarget = path.join(root, "src", "portable-connector-mcp.js");
let portable = fs.readFileSync(portableTarget, "utf8");
const routerAnchor = '  const router = express.Router(); const connector = createGovernedConnector({ executeCommand }); const handle = createPortableMcpHandler({ connector, userId });';
const routerReplacement = '  const router = express.Router(); const connector = createGovernedConnector({ executeCommand }); const handle = createPortableMcpHandler({ connector, userId }); setImmediate(() => connector.resume(userId).catch(error => console.error("[Georgie] connector startup resume failed:", error instanceof Error ? error.message : error)));';
if (!portable.includes('connector startup resume failed')) {
  if (!portable.includes(routerAnchor)) throw new Error("TERMINAL_RECONCILIATION_PORTABLE_RESUME_ANCHOR_NOT_FOUND");
  portable = portable.replace(routerAnchor, routerReplacement);
  fs.writeFileSync(portableTarget, portable);
}
if (!fs.readFileSync(portableTarget, "utf8").includes('connector.resume(userId)')) throw new Error("TERMINAL_RECONCILIATION_PORTABLE_RESUME_VERIFICATION_FAILED");
console.log("[Georgie] durable authoritative terminal reconciliation + certification-priority recovery + normalized manifest gate installed");
