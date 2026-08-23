import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";

export const OBJECTIVE_STATES = Object.freeze([
  "queued","running","waiting_external","verifying","retryable_failure","blocked","human_approval_required","complete","cancelled"
]);

const TERMINAL = new Set(["complete","cancelled"]);
const TRANSITIONS = Object.freeze({
  queued: new Set(["running","blocked","human_approval_required","cancelled"]),
  running: new Set(["waiting_external","verifying","retryable_failure","blocked","human_approval_required","complete","cancelled"]),
  waiting_external: new Set(["running","verifying","retryable_failure","blocked","cancelled"]),
  verifying: new Set(["running","retryable_failure","blocked","human_approval_required","complete","cancelled"]),
  retryable_failure: new Set(["queued","running","blocked","cancelled"]),
  blocked: new Set(["queued","running","human_approval_required","cancelled"]),
  human_approval_required: new Set(["queued","running","cancelled"]),
  complete: new Set(),
  cancelled: new Set()
});

const NS = "objective-control-plane.v1";
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;

function nowIso(now = Date.now()) { return new Date(now).toISOString(); }
function id(prefix="obj") { return `${prefix}_${crypto.randomUUID()}`; }
function clone(v) { return structuredClone(v); }
function asText(v) { return String(v ?? "").trim(); }
function boundedInt(v, fallback, min, max) { const n=Number(v); return Number.isFinite(n)?Math.min(max,Math.max(min,Math.trunc(n))):fallback; }
function stateEnvelope(data={}) { return { version:1, objectives:{}, receipts:{}, updatedAt:null, ...data, objectives:{...(data.objectives||{})}, receipts:{...(data.receipts||{})} }; }
async function load(userId="primary") { return stateEnvelope(await readCloudState(userId, NS, stateEnvelope())); }
async function save(userId, state) { state.updatedAt=nowIso(); const ok=await writeCloudState(userId, NS, state); if(!ok && process.env.GEORGIE_SUPABASE_URL && process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY) throw new Error("objective state was not durably persisted"); return ok; }

export function routeReasoningTier(input={}) {
  const text=asText(input.text).toLowerCase();
  const consequential=Boolean(input.consequentialAction);
  const production=Boolean(input.productionImpact);
  const ambiguity=boundedInt(input.ambiguity,0,0,3);
  const systems=boundedInt(input.systemCount,1,1,20);
  const security=Boolean(input.securitySensitive);
  const destructive=Boolean(input.destructive);
  const hardSignals=[/race condition/,/distributed/,/cross-system/,/root cause/,/architecture/,/security/,/production failure/,/data repair/,/migration/,/incident/].some(r=>r.test(text));
  if (destructive || security || (production && consequential && (systems>=2 || ambiguity>=2))) return { level:"L4", modelClass:"frontier", reason:"consequential production or security work requires maximum verification" };
  if (hardSignals || (production && (systems>=2 || ambiguity>=2)) || systems>=3) return { level:"L3", modelClass:"frontier", reason:"complex or cross-system reasoning materially affects correctness" };
  if (consequential || ambiguity===1 || /code|sql|config|debug|test|deploy/.test(text)) return { level:"L2", modelClass:"standard", reason:"technical work is bounded and does not yet require frontier reasoning" };
  if (/plan|review|status|next|summar|explain|what does|instruction/.test(text)) return { level:"L1", modelClass:"economy", reason:"operator-level coordination or interpretation" };
  return { level:"L0", modelClass:"economy", reason:"routine conversation" };
}

export async function createObjective({ userId="primary", title, instruction, source="chat", idempotencyKey=null, maxAttempts=DEFAULT_MAX_ATTEMPTS, metadata={} }={}) {
  if (!asText(title) || !asText(instruction)) throw new Error("title and instruction are required");
  const state=await load(userId);
  if (idempotencyKey) {
    const existing=Object.values(state.objectives).find(o=>o.idempotencyKey===idempotencyKey && o.state!=="cancelled");
    if (existing) return clone(existing);
  }
  const createdAt=nowIso();
  const objective={
    objectiveId:id(), title:asText(title), instruction:asText(instruction), source:asText(source)||"chat",
    state:"queued", attempt:0, maxAttempts:boundedInt(maxAttempts,DEFAULT_MAX_ATTEMPTS,1,25), idempotencyKey:idempotencyKey||null,
    createdAt, updatedAt:createdAt, completedAt:null, blockedReason:null, nextAttemptAt:null,
    lease:null, checkpoints:[], evidenceReceiptIds:[], history:[{from:null,to:"queued",at:createdAt,reason:"created"}], metadata:clone(metadata||{})
  };
  state.objectives[objective.objectiveId]=objective;
  await save(userId,state);
  return clone(objective);
}

export async function getObjective(userId="primary", objectiveId) {
  const state=await load(userId); return clone(state.objectives[objectiveId]||null);
}

export async function listObjectives(userId="primary", { states=null, limit=100 }={}) {
  const state=await load(userId); const allowed=states?new Set(states):null;
  return Object.values(state.objectives).filter(o=>!allowed||allowed.has(o.state)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,boundedInt(limit,100,1,500)).map(clone);
}

export async function transitionObjective(userId="primary", objectiveId, to, { reason=null, now=Date.now() }={}) {
  if (!OBJECTIVE_STATES.includes(to)) throw new Error(`unknown objective state: ${to}`);
  const state=await load(userId); const objective=state.objectives[objectiveId]; if(!objective) throw new Error("objective not found");
  if (objective.state===to) return clone(objective);
  if (!TRANSITIONS[objective.state]?.has(to)) throw new Error(`illegal objective transition ${objective.state} -> ${to}`);
  if (to==="complete" && objective.evidenceReceiptIds.length===0) throw new Error("objective cannot complete without evidence");
  const at=nowIso(now); const from=objective.state; objective.state=to; objective.updatedAt=at; objective.history.push({from,to,at,reason:reason||null});
  if (to==="running") { objective.attempt+=1; objective.blockedReason=null; objective.nextAttemptAt=null; }
  if (to==="complete") { objective.completedAt=at; objective.lease=null; }
  if (to==="blocked") objective.blockedReason=reason||"blocked";
  if (TERMINAL.has(to)) objective.lease=null;
  await save(userId,state); return clone(objective);
}

export async function acquireObjectiveLease(userId="primary", objectiveId, workerId, { leaseMs=DEFAULT_LEASE_MS, now=Date.now() }={}) {
  if (!asText(workerId)) throw new Error("workerId is required");
  const state=await load(userId); const objective=state.objectives[objectiveId]; if(!objective) throw new Error("objective not found");
  if (TERMINAL.has(objective.state)) return null;
  if (objective.lease && Date.parse(objective.lease.expiresAt)>now && objective.lease.workerId!==workerId) return null;
  const token=id("lease"), acquiredAt=nowIso(now), expiresAt=nowIso(now+boundedInt(leaseMs,DEFAULT_LEASE_MS,5_000,15*60_000));
  objective.lease={workerId:asText(workerId),token,acquiredAt,expiresAt}; objective.updatedAt=acquiredAt;
  await save(userId,state); return clone(objective.lease);
}

export async function checkpointObjective(userId="primary", objectiveId, leaseToken, checkpoint, { now=Date.now() }={}) {
  const state=await load(userId); const objective=state.objectives[objectiveId]; if(!objective) throw new Error("objective not found");
  if (!objective.lease || objective.lease.token!==leaseToken || Date.parse(objective.lease.expiresAt)<=now) throw new Error("active objective lease required");
  const item={checkpointId:id("cp"),at:nowIso(now),data:clone(checkpoint||{})}; objective.checkpoints.push(item); objective.updatedAt=item.at;
  await save(userId,state); return clone(item);
}

export async function appendEvidence(userId="primary", objectiveId, evidence, { verifier="system", now=Date.now() }={}) {
  const state=await load(userId); const objective=state.objectives[objectiveId]; if(!objective) throw new Error("objective not found");
  const kind=asText(evidence?.kind), summary=asText(evidence?.summary); if(!kind||!summary) throw new Error("evidence kind and summary are required");
  const receipt={receiptId:id("rcpt"),objectiveId,kind,summary,verified:Boolean(evidence?.verified),verifier:asText(verifier)||"system",externalRef:evidence?.externalRef||null,hash:evidence?.hash||null,observedAt:evidence?.observedAt||nowIso(now),recordedAt:nowIso(now),details:clone(evidence?.details||{})};
  state.receipts[receipt.receiptId]=receipt; objective.evidenceReceiptIds.push(receipt.receiptId); objective.updatedAt=receipt.recordedAt;
  await save(userId,state); return clone(receipt);
}

export async function markRetryableFailure(userId="primary", objectiveId, error, { now=Date.now(), baseDelayMs=5_000 }={}) {
  const state=await load(userId); const objective=state.objectives[objectiveId]; if(!objective) throw new Error("objective not found");
  if (!["running","waiting_external","verifying"].includes(objective.state)) throw new Error(`cannot fail objective from ${objective.state}`);
  const at=nowIso(now), exhausted=objective.attempt>=objective.maxAttempts;
  const to=exhausted?"blocked":"retryable_failure"; objective.history.push({from:objective.state,to,at,reason:asText(error?.message||error)||"failure"}); objective.state=to; objective.updatedAt=at; objective.lease=null;
  if(exhausted){objective.blockedReason="retry budget exhausted";objective.nextAttemptAt=null;} else {const delay=Math.min(15*60_000,boundedInt(baseDelayMs,5_000,100,60_000)*(2**Math.max(0,objective.attempt-1)));objective.nextAttemptAt=nowIso(now+delay);}
  await save(userId,state); return clone(objective);
}

export async function recoverDueObjectives(userId="primary", { now=Date.now(), limit=25 }={}) {
  const state=await load(userId); const recovered=[];
  for (const objective of Object.values(state.objectives).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))) {
    if (recovered.length>=boundedInt(limit,25,1,100)) break;
    const leaseExpired=objective.lease && Date.parse(objective.lease.expiresAt)<=now;
    const retryDue=objective.state==="retryable_failure" && (!objective.nextAttemptAt || Date.parse(objective.nextAttemptAt)<=now);
    if (!leaseExpired && !retryDue) continue;
    const from=objective.state, at=nowIso(now); objective.state="queued"; objective.lease=null; objective.nextAttemptAt=null; objective.updatedAt=at; objective.history.push({from,to:"queued",at,reason:leaseExpired?"expired lease recovered":"retry window reached"}); recovered.push(objective.objectiveId);
  }
  if(recovered.length) await save(userId,state); return recovered;
}

export function startObjectiveRecoveryWorker({ userId="primary", intervalMs=30_000 }={}) {
  const ms=boundedInt(intervalMs,30_000,5_000,10*60_000);
  recoverDueObjectives(userId).catch(error=>console.warn("Objective recovery scan failed:",error?.message||error));
  const timer=setInterval(()=>recoverDueObjectives(userId).catch(error=>console.warn("Objective recovery scan failed:",error?.message||error)),ms); timer.unref?.(); return timer;
}

export function objectiveControlPlaneContract() {
  return { version:"georgie.objective-control-plane.v1", durableStateNamespace:NS, legalStateMachine:true, leaseCheckpointing:true, boundedRetries:true, evidenceRequiredForCompletion:true, automaticExpiredLeaseRecovery:true, reasoningRouter:["L0","L1","L2","L3","L4"] };
}
