import test from "node:test";
import assert from "node:assert/strict";

process.env.GEORGIE_CLOUD_STATE_ENABLED="false";

const mod=await import(`../src/coordination-control-plane.js?test=${Date.now()}`);
const { objectiveIdFor, authorityDecision, commandEnvelope, ensureObjective, appendEvidence, acquireLock, releaseLock, createHandoff, acknowledgeHandoff, recordCallback, recordCallbackDelivery, listPendingCallbacks, controlPlaneSnapshot, prepareObjectiveControlContext }=mod;

test("objective IDs are deterministic across coordinators",()=>{
  const input={stableKey:"objective:abc",domain:"technical",kind:"engineering",text:"Repair durable orchestration"};
  assert.equal(objectiveIdFor(input),objectiveIdFor({...input}));
  assert.match(objectiveIdFor(input),/^obj_[a-f0-9]{24}$/);
});

test("one authority model prevents escalation by handoff wording",()=>{
  assert.equal(authorityDecision("diagnose").decision,"automatic");
  assert.equal(authorityDecision("production_deploy").decision,"approval_required");
  assert.equal(authorityDecision("weaken_authentication").decision,"prohibited");
  assert.equal(authorityDecision("invent_new_privilege").decision,"unclassified_requires_review");
});

test("command envelopes are typed, integrity hashed, and authority classified",()=>{
  const command=commandEnvelope({objectiveId:"obj_123",issuer:"chatgpt",assignee:"georgie",action:"run_tests",scope:{repo:"Georgie"},idempotencyKey:"k1"});
  assert.equal(command.protocol,"georgie-control.v2");
  assert.equal(command.authority.mayExecute,true);
  assert.match(command.integrityHash,/^[a-f0-9]{64}$/);
});

test("resource locks prevent two assistants from mutating the same surface",async()=>{
  const uid=`locks-${Date.now()}`;
  const first=await acquireLock(uid,{objectiveId:"obj_1",owner:"georgie",resource:"repo:Georgie:file:src/a.js",ttlMs:60000});
  const conflict=await acquireLock(uid,{objectiveId:"obj_1",owner:"chatgpt",resource:"repo:Georgie:file:src/a.js",ttlMs:60000});
  assert.equal(first.ok,true);assert.equal(conflict.ok,false);assert.equal(conflict.status,"conflict");
  await releaseLock(uid,{resource:"repo:Georgie:file:src/a.js",owner:"georgie"});
  const second=await acquireLock(uid,{objectiveId:"obj_1",owner:"chatgpt",resource:"repo:Georgie:file:src/a.js",ttlMs:60000});
  assert.equal(second.ok,true);
});

test("evidence, handoffs, acknowledgements and callbacks share one objective",async()=>{
  const uid=`flow-${Date.now()}`;
  const objective=await ensureObjective(uid,{stableKey:"objective:flow",domain:"technical",kind:"engineering",text:"Shared coordination flow"});
  const ev=await appendEvidence(uid,{objectiveId:objective.id,source:"chatgpt",claim:"Patch verified",refs:["commit:abc"]});
  const offered=await createHandoff(uid,{objectiveId:objective.id,from:"chatgpt",to:"georgie",summary:"Continue deployment verification",evidenceRefs:[ev.id],idempotencyKey:"handoff-flow"});
  const ack=await acknowledgeHandoff(uid,{handoffId:offered.handoff.id,participant:"georgie"});
  await recordCallback(uid,{objectiveId:objective.id,from:"georgie",to:"chatgpt",status:"verified",summary:"Deployment healthy",evidenceRefs:[ev.id]});
  const snapshot=await controlPlaneSnapshot(uid,{objectiveId:objective.id});
  assert.equal(ack.status,"acknowledged");
  assert.equal(snapshot.objectives.length,1);assert.equal(snapshot.evidence.length,1);assert.equal(snapshot.handoffs.length,1);assert.equal(snapshot.callbacks.length,1);
});

test("callback delivery remains pending until provider read-back confirms the exact receipt revision",async()=>{
  const uid=`callback-${Date.now()}`;
  const first=await recordCallback(uid,{objectiveId:"obj_callback",from:"georgie",to:"chatgpt",type:"ai_control_receipt",status:"executed_pending_verification",summary:"Provider mutation executed; verification pending.",deliveryMode:"github_ai_control",idempotencyKey:"ai-control-receipt:cmd-1",metadata:{repository:"GirlDadMula11-sudo/Georgie",issueNumber:68,commandId:"cmd-1"}});
  assert.equal(first.delivered,false);assert.equal(first.deliveryAttempts,0);
  const failed=await recordCallbackDelivery(uid,{callbackId:first.id,delivered:false,error:"lost response",receipt:{ok:false,readBackConfirmed:false,attempts:2,errors:["lost response"]}});
  assert.equal(failed.delivered,false);assert.equal(failed.deliveryAttempts,2);assert.equal(failed.revisionDeliveryAttempts,2);assert.match(failed.lastDeliveryError,/lost response/i);
  assert.equal((await listPendingCallbacks(uid,{deliveryMode:"github_ai_control"})).length,1);
  const confirmed=await recordCallbackDelivery(uid,{callbackId:first.id,delivered:true,receipt:{ok:true,readBackConfirmed:true,attempts:1,commentId:123}});
  assert.equal(confirmed.delivered,true);assert.equal(confirmed.deliveryReadBackConfirmed,true);assert.equal(confirmed.deliveryAttempts,3);
  const revised=await recordCallback(uid,{objectiveId:"obj_callback",from:"georgie",to:"chatgpt",type:"ai_control_receipt",status:"completed",summary:"Provider mutation verified.",deliveryMode:"github_ai_control",idempotencyKey:"ai-control-receipt:cmd-1",metadata:{repository:"GirlDadMula11-sudo/Georgie",issueNumber:68,commandId:"cmd-1",terminal:true}});
  assert.equal(revised.id,first.id);assert.equal(revised.delivered,false);assert.equal(revised.deliveryRevision,2);assert.equal(revised.revisionDeliveryAttempts,0);assert.equal(revised.deliveryAttempts,3);
});

test("connection truth never pretends this ChatGPT conversation has autonomous callbacks",async()=>{
  const uid=`truth-${Date.now()}`;
  const context=await prepareObjectiveControlContext(uid,{stableKey:"objective:truth",domain:"technical",kind:"engineering",text:"Verify connection truth"});
  assert.equal(context.connectionTruth.chatgptAutonomousCallback,false);
  assert.equal(context.connectionTruth.chatgptConversationRequired,true);
  assert.equal(context.connectionTruth.georgiePersistent,true);
});
