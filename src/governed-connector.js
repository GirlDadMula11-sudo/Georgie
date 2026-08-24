import crypto from "node:crypto";
import express from "express";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { upsertOperatingNode, transitionOperatingNode } from "./operating-graph.js";
import { enqueueMacJob, listMacJobs, resumeFailedMacJob } from "./mac/queue.js";
import { getMacDeviceStatus } from "./mac/router.js";
import { listMailboxPacketManifests } from "./mailbox-evidence-bridge.js";

const NS = "governed_external_connector";
const SCHEMA = "georgie.governed-connector.v1";
const locks = new Map();
const now = () => new Date().toISOString();
const clean = (value, max = 6000) => String(value || "").trim().slice(0, max);
const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
export function summarizeGovernedMacJob(job = {}) { return { id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, authority: job.args?.authority || null, checkpoint: job.args?.checkpoint || null, attempts: job.attempts, claimedAt: job.claimedAt, completedAt: job.completedAt, error: job.error, dispatchReceipt: job.dispatchReceipt, cursor: job.result?.mailboxEvidenceBatch?.cursor || {}, packetCount: job.result?.mailboxEvidenceBatch?.packets?.length || 0, quarantineCount: job.result?.quarantine?.length || job.result?.mailboxEvidenceBatch?.quarantine?.length || 0, connections: job.result?.connection || null, staticContractInspection: job.result?.neoStaticContractInspection || null }; }
const CAPABILITIES = Object.freeze({
  "primary_mac.neo.cdp_read_only": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["verify_session"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "mailbox.write"])
  }),
  "primary_mac.mailbox.read_only": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["connection_verify_and_backfill", "static_contract_inspection"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation"])
  }),
  "neo_mailbox_evidence_bridge": Object.freeze({
    targetDevice: "primary-mac",
    authority: "read_only",
    operations: new Set(["connection_verify_and_backfill", "static_contract_inspection"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "sierra.diagnostic_investigation", "sierra.continue_diagnostic_investigation"])
  }),
  "primary_mac.agent.maintenance": Object.freeze({
    targetDevice: "primary-mac",
    authority: "local_admin",
    operations: new Set(["update_restart_from_main", "install_neo_preload", "inspect_neo_preload", "normalize_generated_lock", "apply_neo_manifest_fix"]),
    prohibitedRoutes: new Set(["cm-100", "stale_continuation", "gmail", "apple_mail", "mailbox.read", "mailbox.write"])
  })
});

function baseState() { return { schema: SCHEMA, version: 2, commands: [], leases: [], events: [], receipts: [], updatedAt: null }; }
export function normalizeConnectorState(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return { ...baseState(), ...input, schema: SCHEMA, version: 2, commands: Array.isArray(input.commands) ? input.commands : [], leases: Array.isArray(input.leases) ? input.leases : [], events: Array.isArray(input.events) ? input.events : [], receipts: Array.isArray(input.receipts) ? input.receipts : [] };
}
function commandId(userId, source, key) { return `cmd_${digest(`${userId}:${source}:${key}`).slice(0, 32)}`; }
function objectiveId(userId, source, supplied, command) { return supplied ? clean(supplied, 160) : `obj_${digest(`${userId}:${source}:${command}`).slice(0, 32)}`; }
function receiptFor(command, status, payload = {}) {
  const createdAt = now();
  const body = { commandId: command.id, objectiveId: command.objectiveId, status, createdAt, payload };
  return { ...body, receiptId: `rcpt_${digest(JSON.stringify(body)).slice(0, 32)}` };
}
async function exclusive(userId, work) {
  const key = String(userId); const prior = locks.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(work); locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}

export function validateCommandEnvelope(input = {}) {
  const source = clean(input.source || "chatgpt", 80).toLowerCase();
  const idempotencyKey = clean(input.idempotencyKey, 200);
  const command = clean(input.command);
  const kind = input.kind === "approval" ? "approval" : "command";
  if (!/^[a-z0-9._-]{2,80}$/.test(source)) throw new Error("A valid connector source is required");
  if (!idempotencyKey) throw new Error("An idempotency key is required");
  if (!command) throw new Error("A command is required");
  if (kind === "approval" && (!clean(input.planId, 160) || !clean(input.approvalId, 160))) throw new Error("Approval forwarding requires both planId and approvalId");
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const nested = metadata.command_envelope && typeof metadata.command_envelope === "object" ? metadata.command_envelope : {};
  const objectiveIdValue = clean(input.objective_id || input.objectiveId || nested.objective_id || nested.objectiveId, 160) || null;
  const capability = clean(input.capability || metadata.capability || metadata.requiredCapability || nested.capability, 160).toLowerCase();
  const targetDevice = clean(input.target_device || input.targetDevice || metadata.target_device || metadata.targetDevice || metadata.deviceId || nested.target_device || nested.targetDevice, 160);
  const operation = clean(input.operation || metadata.operation || nested.operation, 160).toLowerCase();
  const authority = clean(input.authority || metadata.authority || metadata.mode || nested.authority, 80).toLowerCase();
  const prohibitedRoutes = [...new Set((input.prohibited_routes || metadata.prohibited_routes || metadata.prohibitedRoutes || nested.prohibited_routes || nested.prohibitedRoutes || []).map((value) => clean(value, 160).toLowerCase()).filter(Boolean))];
  const typed = Boolean(capability || targetDevice || operation || authority || prohibitedRoutes.length);
  if (typed && !objectiveIdValue) throw new Error("Typed command envelope requires objective_id");
  if (typed && (!capability || !targetDevice || !operation || !authority)) throw new Error("Typed command envelope requires capability, target_device, operation, and authority");
  if (typed) {
    const contract = CAPABILITIES[capability];
    if (!contract) throw new Error(`UNSUPPORTED_CAPABILITY: ${capability}`);
    if (targetDevice !== contract.targetDevice) throw new Error(`CAPABILITY_TARGET_MISMATCH: ${capability} requires ${contract.targetDevice}`);
    if (authority !== contract.authority) throw new Error(`CAPABILITY_AUTHORITY_MISMATCH: ${capability} requires ${contract.authority}`);
    if (!contract.operations.has(operation)) throw new Error(`UNSUPPORTED_OPERATION: ${capability}/${operation}`);
    for (const route of prohibitedRoutes) if (!contract.prohibitedRoutes.has(route)) throw new Error(`UNKNOWN_PROHIBITED_ROUTE: ${route}`);
  }
  return { source, idempotencyKey, command, kind, objectiveId: objectiveIdValue, planId: clean(input.planId, 160) || null, approvalId: clean(input.approvalId, 160) || null, metadata, routing: typed ? { objective_id: objectiveIdValue, capability, target_device: targetDevice, operation, authority, idempotency_key: idempotencyKey, prohibited_routes: prohibitedRoutes } : null };
}

async function executeTypedCapability({ userId, command }) {
  const route = command.routing;
  if (route.capability === "primary_mac.neo.cdp_read_only") {
    const job = await enqueueMacJob({ userId, deviceId: route.target_device, action: "mailbox.neo_cdp_verify_session", args: { objectiveId: route.objective_id, authority: route.authority, mailboxes: command.metadata?.mailboxes || [] }, risk: "read", reason: "Verify local loopback CDP and exact NEO mailbox bindings without message access", idempotencyKey: `connector:${command.id}:${route.operation}`, maxAttempts: 1 });
    return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };
  }
  if (route.capability === "primary_mac.agent.maintenance") {
    const repo = clean(command.metadata?.repo || "/Users/mac/Georgie", 300);
    if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
    const lockPatch = `diff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1,12 +1,12 @@\n {\n   "name": "georgie",\n-  "version": "2.2.22",\n+  "version": "2.2.21",\n   "lockfileVersion": 3,\n   "requires": true,\n   "packages": {\n     "": {\n       "name": "georgie",\n-      "version": "2.2.22",\n+      "version": "2.2.21",\n       "dependencies": {\n         "dotenv": "^16.4.5",\n         "express": "^4.21.1",\n`;
    const neoManifestPatch = "diff --git a/mac-agent/neo-preload-extension/manifest.json b/mac-agent/neo-preload-extension/manifest.json\n--- a/mac-agent/neo-preload-extension/manifest.json\n+++ b/mac-agent/neo-preload-extension/manifest.json\n@@ -1,7 +1,7 @@\n {\n   \"manifest_version\": 3,\n   \"name\": \"Georgie NEO Read-Only Preload\",\n-  \"version\": \"1.6.0\",\n+  \"version\": \"1.6.1\",\n   \"description\": \"Local read-only Chrome debugger relay for the governed NEO evidence bridge.\",\n   \"permissions\": [\n     \"debugger\"\n@@ -16,6 +16,16 @@\n     {\n       \"matches\": [\n         \"https://app.neo.space/*\"\n+      ],\n+      \"js\": [\n+        \"preload.js\"\n+      ],\n+      \"run_at\": \"document_start\",\n+      \"world\": \"MAIN\"\n+    },\n+    {\n+      \"matches\": [\n+        \"https://app.neo.space/*\"\n       ],\n       \"js\": [\n         \"diagnostic.js\"\n";
    const specs = route.operation === "apply_neo_manifest_fix"
      ? [["developer.apply_patch", { repo, patch: neoManifestPatch, patchHash: digest(neoManifestPatch) }, "Apply the exact scoped NEO document-start manifest repair"]]
      : route.operation === "install_neo_preload"
      ? [["developer.install_neo_preload", { repo }, "Install the controlled NEO document-start preload and relaunch Chrome"]]
      : route.operation === "inspect_neo_preload"
        ? [["developer.inspect_neo_preload", { repo }, "Inspect the controlled NEO preload without accessing mailbox content"]]
      : route.operation === "normalize_generated_lock"
        ? [["developer.apply_patch", { repo, patch: lockPatch, patchHash: digest(lockPatch) }, "Normalize the exact installer-generated package-lock version drift"]]
        : [["developer.update_restart_from_main", { repo }, "Fast-forward the allowlisted Georgie checkout and restart the Mac agent"]];
    const jobs = [];
    for (let index = 0; index < specs.length; index += 1) {
      const [action, args, reason] = specs[index];
      jobs.push(await enqueueMacJob({ userId, deviceId: route.target_device, action, args, risk: "sensitive_write", reason, idempotencyKey: `connector:${command.id}:${route.operation}:developer-bootstrap:${index}`, maxAttempts: 1 }));
    }
    return { terminalState: "in_progress", completed: false, route, jobs: jobs.map((job) => ({ id: job.id, status: job.status, action: job.action, deviceId: job.deviceId, dispatchReceipt: job.dispatchReceipt })), expectedAgentVersion: clean(command.metadata?.expected_agent_version, 50) || null };
  }
  if (!["primary_mac.mailbox.read_only", "neo_mailbox_evidence_bridge"].includes(route.capability)) throw new Error(`UNSUPPORTED_CAPABILITY: ${route.capability}`);
  if (route.operation === "static_contract_inspection") {
    const job = await enqueueMacJob({ userId, deviceId: route.target_device, action: "mailbox.neo_static_contract_inspect", args: { objectiveId: route.objective_id, operation: route.operation, authority: route.authority }, risk: "read", reason: "Fail-closed static inspection of NEO bundle contracts", idempotencyKey: `connector:${command.id}:${route.operation}`, maxAttempts: 1 });
    return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, claimedByDeviceId: job.dispatchReceipt?.deviceId || null, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };
  }
  const existingJobId = clean(command.metadata?.existing_job_id || command.metadata?.existingJobId, 200);
  let job;
  if (existingJobId) {
    job = (await listMacJobs(userId, 500)).find((item) => item.id === existingJobId);
    if (!job) throw new Error(`MAC_JOB_NOT_FOUND: ${existingJobId}`);
    if (job.deviceId !== route.target_device || job.action !== "mailbox.read_only_backfill" || job.risk !== "read" || job.args?.authority !== "read_only") throw new Error("MAC_JOB_RESUME_SCOPE_REJECTED");
    if (String(job.args?.objectiveId || "") !== route.objective_id) throw new Error("MAC_JOB_OBJECTIVE_MISMATCH");
    if (["failed", "dead_letter", "completed"].includes(job.status)) job = await resumeFailedMacJob(route.target_device, existingJobId, { objectiveId: route.objective_id, expectedAction: "mailbox.read_only_backfill", verifiedAgentVersion: clean(command.metadata?.verified_agent_version, 50) || null });
  } else {
    job = await enqueueMacJob({
      userId,
      deviceId: route.target_device,
      action: "mailbox.read_only_backfill",
      args: { objectiveId: route.objective_id, operation: route.operation, authority: route.authority, checkpoint: command.metadata?.checkpoint || "connection_verification", mailboxes: command.metadata?.mailboxes || [], batchLimit: Math.min(25, Math.max(1, Number(command.metadata?.batchLimit || 25))) },
      risk: "read",
      reason: "Typed governed mailbox backfill",
      idempotencyKey: `connector:${command.id}:${route.operation}`
    });
  }
  return { terminalState: "in_progress", completed: false, route, job: { id: job.id, status: job.status, deviceId: route.target_device, claimedByDeviceId: job.dispatchReceipt?.deviceId || null, action: job.action, authority: route.authority, dispatchReceipt: job.dispatchReceipt } };
}

export function createGovernedConnector({ executeCommand, emitStatus = async () => {}, readState, writeState, retainObjective, transitionObjective, leaseTtlMs = 30_000, ownerId = null } = {}) {
  if (typeof executeCommand !== "function") throw new Error("Connector requires an executeCommand function");
  const readStore = readState || ((userId) => readCloudState(String(userId), NS, baseState()));
  const writeStore = writeState || ((userId, state) => writeCloudState(String(userId), NS, state));
  const retain = retainObjective || ((userId, input) => upsertOperatingNode(userId, input));
  const transition = transitionObjective || ((userId, id, input) => transitionOperatingNode(userId, id, input));
  const workerId = clean(ownerId || `connector-worker:${process.pid}:${crypto.randomUUID()}`, 180);
  const boundedLeaseTtlMs = Math.max(1_000, Math.min(300_000, Number(leaseTtlMs) || 30_000));
  async function read(userId) { return structuredClone(normalizeConnectorState(await readStore(userId))); }
  async function persist(userId, state) { state.updatedAt = now(); await writeStore(userId, state); return state; }
  function leaseFor(state, commandIdValue) { return state.leases.find((row) => row.commandId === commandIdValue) || null; }
  function leasePublic(lease) { return lease ? structuredClone(lease) : null; }
  async function readLease(userId, commandIdValue) { const state=await read(userId); return leasePublic(leaseFor(state,commandIdValue)); }
  function activeLease(lease, at = Date.now()) { return lease && ["queued", "running"].includes(lease.status) && Date.parse(lease.expiresAt || 0) > at; }
  function terminalLease(lease) { return lease && ["completed", "blocked", "failed", "cancelled"].includes(lease.status); }
  function newLease(command) { const createdAt=now(); return { id:`lease_${digest(`${command.id}:${command.objectiveId}`).slice(0,32)}`, commandId:command.id, objectiveId:command.objectiveId, status:"queued", owner:null, generation:0, claimedAt:null, heartbeatAt:null, expiresAt:new Date(Date.now()+boundedLeaseTtlMs).toISOString(), attempts:0, terminalReceiptId:null, createdAt, updatedAt:createdAt }; }
  async function acquireOrReturnLease(userId, command, { reclaim = true } = {}) { return exclusive(userId, async()=>{ const state=await read(userId); let lease=leaseFor(state,command.id); if(!lease){lease=newLease(command);state.leases.push(lease);await persist(userId,state);return{acquired:false,created:true,lease:leasePublic(lease)}} if(terminalLease(lease))return{acquired:false,terminal:true,lease:leasePublic(lease)}; const at=Date.now(); if(lease.status==="queued"||(!activeLease(lease,at)&&reclaim)){lease.owner=workerId;lease.generation=Number(lease.generation||0)+1;lease.status="running";lease.claimedAt=now();lease.heartbeatAt=lease.claimedAt;lease.expiresAt=new Date(at+boundedLeaseTtlMs).toISOString();lease.attempts=Number(lease.attempts||0)+1;lease.updatedAt=lease.claimedAt;await persist(userId,state);return{acquired:true,reclaimed:lease.generation>1,lease:leasePublic(lease)}} return{acquired:lease.owner===workerId,lease:leasePublic(lease)}; }); }
  async function heartbeatLease(userId, claim) { return exclusive(userId,async()=>{ const state=await read(userId),lease=leaseFor(state,claim?.commandId); if(!lease||lease.id!==claim?.id||lease.owner!==workerId||Number(lease.generation)!==Number(claim?.generation)||terminalLease(lease))return{ok:false,fenced:true,lease:leasePublic(lease)}; lease.heartbeatAt=now();lease.expiresAt=new Date(Date.now()+boundedLeaseTtlMs).toISOString();lease.updatedAt=lease.heartbeatAt;await persist(userId,state);return{ok:true,lease:leasePublic(lease)}; }); }
  async function record(userId, command, status, payload = {}, claim = null) { return exclusive(userId,async()=>{ const state=await read(userId),item=state.commands.find(row=>row.id===command.id),lease=leaseFor(state,command.id); if(claim&&(!lease||lease.id!==claim.id||lease.owner!==workerId||Number(lease.generation)!==Number(claim.generation)))throw new Error("LEASE_FENCED: execution ownership changed before terminalization"); if(item){item.status=status;item.updatedAt=now();if(["completed","blocked"].includes(status))item.completedAt=item.updatedAt;if(["failed","recovering","blocked"].includes(status))item.error=clean(payload.error,1000);if(payload.resultSummary)item.result=payload.resultSummary;} const event={id:crypto.randomUUID(),commandId:command.id,objectiveId:command.objectiveId,status,createdAt:now()},receipt=receiptFor(command,status,payload); if(lease&&claim){lease.status=status==="completed"?"completed":status==="blocked"?"blocked":status==="failed"?"failed":status==="recovering"?"queued":status;lease.terminalReceiptId=["completed","blocked","failed"].includes(status)?receipt.receiptId:lease.terminalReceiptId;lease.updatedAt=event.createdAt;if(lease.status==="queued"){lease.owner=null;lease.expiresAt=new Date(Date.now()+boundedLeaseTtlMs).toISOString();}} state.events.push(event);state.receipts.push(receipt);await persist(userId,state);await emitStatus({...event,receipt}).catch(()=>{});return receipt; }); }
  async function run(userId, command) { const claimResult=await acquireOrReturnLease(userId,command); if(claimResult.terminal||!claimResult.acquired)return{commandId:command.id,objectiveId:command.objectiveId,status:claimResult.lease?.status||command.status,lease:claimResult.lease,duplicateExecutionPrevented:true}; const claim=claimResult.lease; await record(userId,command,"running",{},claim); await transition(userId,command.operatingNodeId,{status:"active",attempted:true,nextAction:"Execute, verify, and return durable evidence."}).catch(()=>{}); const heartbeat=setInterval(()=>heartbeatLease(userId,claim).catch(()=>{}),Math.max(500,Math.floor(boundedLeaseTtlMs/3)));heartbeat.unref?.(); try{ const result=command.routing?await executeTypedCapability({userId,command}):await executeCommand({userId,sessionId:`connector:${command.source}:objective:${command.objectiveId}`,input:command.command,connector:{commandId:command.id,objectiveId:command.objectiveId,planId:command.planId,approvalId:command.approvalId,leaseId:claim.id,leaseGeneration:claim.generation}}); const resultSummary=command.routing?{terminalState:result?.terminalState||null,completed:result?.completed===true,route:result?.route||null,job:result?.job||null,jobs:result?.jobs||null,expectedAgentVersion:result?.expectedAgentVersion||null}:{text:clean(result?.text||result?.response||"",50000),actions:Array.isArray(result?.actions)?result.actions.slice(0,100):[]}; const terminalState=clean(result?.outcome?.terminalState||result?.terminalState||(result?.completed===false?"recovering":"completed"),80),evidence={responseHash:digest(JSON.stringify(result||{})),terminalState,...(resultSummary?{resultSummary}:{})}; if(result?.completed===false||["in_progress","working","recovering","queued","running"].includes(terminalState)){const receipt=await record(userId,command,"recovering",{...evidence,error:clean(result?.error||result?.exactBlocker||terminalState,1000)},claim);await transition(userId,command.operatingNodeId,{status:"recovering",recovery:"Resume this same command and lease checkpoint; do not create a duplicate.",nextAction:"Continue from the durable lease checkpoint."}).catch(()=>{});return{commandId:command.id,objectiveId:command.objectiveId,status:"recovering",result,receipt,lease:await readLease(userId,command.id)};} const blocked=terminalState==="blocked"||result?.outcome?.terminalState==="blocked"; const receipt=await record(userId,command,blocked?"blocked":"completed",evidence,claim);await transition(userId,command.operatingNodeId,blocked?{status:"blocked",nextAction:clean(result?.exactBlocker||result?.error||"Resolve the verified blocker and resume the same objective.",1000)}:{status:"verified",verification:`Connector completion receipt ${receipt.receiptId}`}).catch(()=>{});return{commandId:command.id,objectiveId:command.objectiveId,status:blocked?"blocked":"completed",result,receipt,lease:await readLease(userId,command.id)}; }catch(error){const message=error instanceof Error?error.message:String(error);if(/^LEASE_FENCED:/.test(message))return{commandId:command.id,objectiveId:command.objectiveId,status:(await readLease(userId,command.id))?.status||"running",error:message,lease:await readLease(userId,command.id),duplicateExecutionPrevented:true};const receipt=await record(userId,command,"recovering",{error:message},claim);await transition(userId,command.operatingNodeId,{status:"recovering",recovery:"Resume this same command ID after the temporary blocker is resolved; do not create a duplicate.",nextAction:message}).catch(()=>{});return{commandId:command.id,objectiveId:command.objectiveId,status:"recovering",error:message,receipt,lease:await readLease(userId,command.id)};}finally{clearInterval(heartbeat);} }
  function schedule(userId,command){setImmediate(()=>run(userId,command).catch(error=>console.error(`[Georgie] connector background execution failed ${command.id}:`,error instanceof Error?error.stack||error.message:error)));}
  async function submit(userId="primary",input={}){const envelope=validateCommandEnvelope(input);let command,duplicate=false,acceptedReceipt,lease;await exclusive(userId,async()=>{const state=await read(userId),id=commandId(userId,envelope.source,envelope.idempotencyKey),existing=state.commands.find(row=>row.id===id);if(existing){command=existing;duplicate=true;lease=leaseFor(state,id);return;}const objective=objectiveId(userId,envelope.source,envelope.objectiveId,envelope.command),node=await retain(userId,{stableKey:`connector:${objective}`,kind:envelope.kind==="approval"?"execution":"objective",title:envelope.command.slice(0,240),domain:"general",status:"planned",nextAction:"Dispatch through the governed connector and preserve completion evidence.",approvalId:envelope.approvalId});command={id,objectiveId:objective,operatingNodeId:node.id,...envelope,status:"accepted",attempts:0,createdAt:now(),updatedAt:now()};lease=newLease(command);state.commands.push(command);state.leases.push(lease);const event={id:crypto.randomUUID(),commandId:id,objectiveId:objective,status:"accepted",createdAt:now()};acceptedReceipt=receiptFor(command,"accepted",{leaseId:lease.id});state.events.push(event);state.receipts.push(acceptedReceipt);await persist(userId,state);await emitStatus({...event,receipt:acceptedReceipt}).catch(()=>{});});if(duplicate)return{commandId:command.id,objectiveId:command.objectiveId,status:command.status,duplicate:true,lease:leasePublic(lease),result:command.result||null};schedule(userId,command);return{commandId:command.id,objectiveId:command.objectiveId,status:"accepted",lease:leasePublic(lease),receipt:acceptedReceipt};}
  async function status(userId="primary",id){const state=await read(userId),command=state.commands.find(row=>row.id===id);if(!command)return null;const response={...command,lease:leasePublic(leaseFor(state,id)),events:state.events.filter(row=>row.commandId===id),receipts:state.receipts.filter(row=>row.commandId===id)};if(command.routing?.capability==="primary_mac.agent.maintenance"){const ids=new Set((command.result?.jobs||[]).map(job=>job.id));response.macJobs=(await listMacJobs(userId,500)).filter(job=>ids.has(job.id)).map(job=>({id:job.id,status:job.status,action:job.action,deviceId:job.deviceId,attempts:job.attempts,claimedAt:job.claimedAt,completedAt:job.completedAt,error:job.error,dispatchReceipt:job.dispatchReceipt}));response.macDevices=getMacDeviceStatus();}const jobId=clean(command.result?.job?.id||command.metadata?.existing_job_id||command.metadata?.existingJobId,200);if(jobId&&command.objectiveId){const job=(await listMacJobs(userId,500)).find(item=>item.id===jobId&&String(item.args?.objectiveId||"")===command.objectiveId);if(job)response.macJob=summarizeGovernedMacJob(job);response.packetManifests=await listMailboxPacketManifests(userId,{objectiveId:command.objectiveId,limit:25});}return response;}
  async function resume(userId="primary"){const state=await read(userId),pending=state.commands.filter(row=>["accepted","running","recovering","failed"].includes(row.status)),scheduled=[];for(const command of pending){const lease=leaseFor(state,command.id);if(!activeLease(lease)||lease?.status==="queued"){schedule(userId,command);scheduled.push({commandId:command.id,objectiveId:command.objectiveId});}}return scheduled;}
  return{submit,status,resume,run,acquireOrReturnLease,heartbeatLease};
}

function authorized(req) {
  const expected = clean(process.env.GEORGIE_CONNECTOR_TOKEN, 500); const supplied = clean(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), 500);
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function createGovernedConnectorRouter({ executeCommand, emitStatus } = {}) {
  const router = express.Router(); const connector = createGovernedConnector({ executeCommand, emitStatus });
  router.use((req, res, next) => authorized(req) ? next() : res.status(401).json({ ok: false, error: "Governed connector authentication required" }));
  router.post("/commands", async (req, res) => { try { const result = await connector.submit(req.body?.userId || "primary", req.body || {}); res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Connector command rejected" }); } });
  router.post("/approvals", async (req, res) => { try { const body = { ...(req.body || {}), kind: "approval", command: req.body?.command || `Approve plan ${req.body?.planId} under approval ${req.body?.approvalId}` }; const result = await connector.submit(body.userId || "primary", body); res.status(result.duplicate ? 200 : 202).json({ ok: true, ...result }); } catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Approval forwarding rejected" }); } });
  router.get("/commands/:id", async (req, res) => { const result = await connector.status(req.query?.userId || "primary", req.params.id); res.status(result ? 200 : 404).json(result ? { ok: true, command: result } : { ok: false, error: "Command not found" }); });
  return router;
}
