import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
// Node runs test files concurrently. Give this entire file a private physical
// queue so another suite cannot restore or claim its exact preserved job ID.
process.env.GEORGIE_DATA_DIR = path.join(os.tmpdir(), `georgie-mac-dispatch-integrity-${process.pid}-${crypto.randomUUID()}`);
const { compactJobStore, enqueueMacJob, claimMacJobs, checkpointMacJob, completeMacJob, importRecoveredMacJob, listMacJobs, reconcileMacDispatches, recoverLongRunningMacJob, repairRecoveredMailboxPayload, resumeFailedMacJob, versionRecoverableMailboxJob } = await import("../src/mac/queue.js");

test("Rojo install-and-build receives a long-running claim lease",async()=>{
  const nonce=`${Date.now()}-${Math.random()}`,userId=`rojo-lease-${nonce}`,deviceId=`lease-test-mac-${nonce}`;
  const job=await enqueueMacJob({userId,deviceId,action:"roblox.install_rojo_and_build",args:{},risk:"sensitive_write",reason:"test",idempotencyKey:`rojo-${nonce}`});
  const claimed=(await claimMacJobs(deviceId,50,{agentVersion:"2.2.39"})).find(item=>item.id===job.id);
  assert.equal(claimed.id,job.id);
  assert.ok(new Date(claimed.claimLeaseExpiresAt)-new Date(claimed.claimedAt)>=14*60_000);
});

test("long-running checkpoints renew the durable lease and exhausted replay keeps one identity",async()=>{
  const nonce=`${Date.now()}-${Math.random()}`,key=`rojo-resume-${nonce}`,deviceId=`rojo-mac-${nonce}`;
  const job=await enqueueMacJob({userId:`rojo-user-${nonce}`,deviceId,action:"roblox.install_rojo_and_build",args:{requiredAgentVersion:"2.2.39"},risk:"sensitive_write",idempotencyKey:key,maxAttempts:1});
  const claimed=(await claimMacJobs(deviceId,50,{agentVersion:"2.2.39"})).find(item=>item.id===job.id),before=claimed.claimLeaseExpiresAt;
  const renewed=await checkpointMacJob(deviceId,job.id,{nextStep:0,stepId:"install",receipt:{stepId:"install",status:"running"}});assert.ok(new Date(renewed.claimLeaseExpiresAt)>=new Date(before));
  await reconcileMacDispatches({nowMs:new Date(renewed.claimLeaseExpiresAt).getTime()+1});
  const replay=await enqueueMacJob({userId:`rojo-user-${nonce}`,deviceId,action:"roblox.install_rojo_and_build",args:{requiredAgentVersion:"2.2.39"},risk:"sensitive_write",idempotencyKey:key,maxAttempts:5});
  assert.equal(replay.id,job.id);assert.equal(replay.status,"queued");assert.equal(replay.args.requiredAgentVersion,"2.2.39");assert.equal(replay.resumeHistory.at(-1).reason,"long_running_checkpoint_transport_repaired");
});

test("lease-expired queued Rojo recovery rebinds the same identity to the repaired agent",async()=>{
  const nonce=`${Date.now()}-${Math.random()}`,key=`rojo-stale-${nonce}`,deviceId=`rojo-stale-mac-${nonce}`;
  const job=await enqueueMacJob({userId:`rojo-stale-user-${nonce}`,deviceId,action:"roblox.install_rojo_and_build",args:{requiredAgentVersion:"2.2.38"},risk:"sensitive_write",idempotencyKey:key,maxAttempts:5});
  const claimed=(await claimMacJobs(deviceId,50,{agentVersion:"2.2.38"})).find(item=>item.id===job.id);
  await reconcileMacDispatches({nowMs:new Date(claimed.claimLeaseExpiresAt).getTime()+1});
  const recovered=await recoverLongRunningMacJob(deviceId,job.id,{expectedAction:"roblox.install_rojo_and_build",requiredAgentVersion:"2.2.39"});
  assert.equal(recovered.id,job.id);assert.equal(recovered.status,"queued");assert.equal(recovered.attempts,0);assert.equal(recovered.args.requiredAgentVersion,"2.2.39");assert.equal(recovered.resumeHistory.at(-1).reason,"long_running_checkpoint_transport_repaired");
  const reclaimed=(await claimMacJobs(deviceId,50,{agentVersion:"2.2.39"})).find(item=>item.id===job.id);assert.equal(reclaimed.id,job.id);
});

test("screenshot-only Roblox play-test failure recovers the same identity",async()=>{
  const nonce=`${Date.now()}-${Math.random()}`,key=`playtest-screenshot-${nonce}`,deviceId=`playtest-mac-${nonce}`;
  const job=await enqueueMacJob({userId:`playtest-user-${nonce}`,deviceId,action:"roblox.play_test_validate",args:{requiredAgentVersion:"2.2.44"},risk:"sensitive_write",idempotencyKey:key,maxAttempts:5});
  await claimMacJobs(deviceId,50,{agentVersion:"2.2.44"});
  await completeMacJob(deviceId,job.id,{error:"Command failed: screencapture -x /tmp/georgie-roblox-playtest.png"});
  const recovered=await recoverLongRunningMacJob(deviceId,job.id,{expectedAction:"roblox.play_test_validate",requiredAgentVersion:"2.2.53"});
  assert.equal(recovered.id,job.id);
  assert.equal(recovered.status,"queued");
  assert.equal(recovered.resumeCount,1);
  assert.equal(recovered.args.requiredAgentVersion,"2.2.53");
  assert.equal(recovered.resumeHistory.at(-1).reason,"play_test_screenshot_evidence_repaired");
});

test("runtime-marker-only Roblox play-test block recovers for exact artifact-window repair",async()=>{
  const nonce=`${Date.now()}-${Math.random()}`,key=`playtest-window-${nonce}`,deviceId=`playtest-window-mac-${nonce}`;
  const job=await enqueueMacJob({userId:`playtest-window-user-${nonce}`,deviceId,action:"roblox.play_test_validate",args:{requiredAgentVersion:"2.2.45"},risk:"sensitive_write",idempotencyKey:key,maxAttempts:5});
  await claimMacJobs(deviceId,50,{agentVersion:"2.2.45"});
  await completeMacJob(deviceId,job.id,{result:{status:"blocked",defects:["RUNTIME_PROTOTYPE_MARKER_NOT_OBSERVED"],playStarted:false,playStopped:true,studioWindowNames:"Place1 - Roblox Studio"}});
  const recovered=await recoverLongRunningMacJob(deviceId,job.id,{expectedAction:"roblox.play_test_validate",requiredAgentVersion:"2.2.53"});
  assert.equal(recovered.id,job.id);
  assert.equal(recovered.status,"queued");
  assert.equal(recovered.resumeCount,1);
  assert.equal(recovered.args.requiredAgentVersion,"2.2.53");
  assert.equal(recovered.resumeHistory.at(-1).reason,"play_test_exact_artifact_window_repaired");
});

test("blank Place1 Roblox play-test block recovers the same identity for native File Open repair",async()=>{
  const nonce=`${Date.now()}-${Math.random()}`,key=`playtest-native-open-${nonce}`,deviceId=`playtest-native-open-mac-${nonce}`;
  const job=await enqueueMacJob({userId:`playtest-native-open-user-${nonce}`,deviceId,action:"roblox.play_test_validate",args:{requiredAgentVersion:"2.2.46"},risk:"sensitive_write",idempotencyKey:key,maxAttempts:5});
  await claimMacJobs(deviceId,50,{agentVersion:"2.2.46"});
  await completeMacJob(deviceId,job.id,{result:{status:"blocked",defects:["ROBLOX_PROTOTYPE_WINDOW_NOT_READY"],playStarted:false,playStopped:true,studioWindowNames:"Place1 - Roblox Studio",studioWindowMatched:false,studioDocumentPath:""}});
  const recovered=await recoverLongRunningMacJob(deviceId,job.id,{expectedAction:"roblox.play_test_validate",requiredAgentVersion:"2.2.53"});
  assert.equal(recovered.id,job.id);
  assert.equal(recovered.status,"queued");
  assert.equal(recovered.resumeCount,1);
  assert.equal(recovered.args.requiredAgentVersion,"2.2.53");
  assert.equal(recovered.resumeHistory.at(-1).reason,"play_test_keyboard_default_open_repaired");
});

test("approved missing Makayla play-test ledger entry is restored once under the exact identity",async()=>{
  const jobId="idem-cb7e9b3ba3d078186977ba33a5a18acc371cb90f",planId="f4977010-f9e2-41be-ae0f-955702e45917",approvalId="3a5369b0-1caa-4a07-bda1-fd73e74bfc24",governance={planId,approvalId,idempotencyKey:`approval:${approvalId}:plan:${planId}`};
  await assert.rejects(()=>recoverLongRunningMacJob("primary-mac",jobId,{expectedAction:"roblox.play_test_validate",requiredAgentVersion:"2.2.66",governance:{...governance,approvalId:"wrong"}}),/MAC_LONG_RUNNING_RESTORATION_APPROVAL_REJECTED/);
  await assert.rejects(()=>recoverLongRunningMacJob("primary-mac",jobId,{expectedAction:"roblox.play_test_validate",requiredAgentVersion:"2.2.66",governance:{...governance,idempotencyKey:"approval:wrong"}}),/MAC_LONG_RUNNING_RESTORATION_APPROVAL_REJECTED/);
  const first=await recoverLongRunningMacJob("primary-mac",jobId,{expectedAction:"roblox.play_test_validate",requiredAgentVersion:"2.2.66",governance});
  const second=await recoverLongRunningMacJob("primary-mac",jobId,{expectedAction:"roblox.play_test_validate",requiredAgentVersion:"2.2.66",governance});
  assert.equal(first.id,jobId);assert.equal(second.id,jobId);assert.equal(first.status,"queued");assert.equal(first.retention,"pinned");assert.equal(first.args.projectRoot,"/Users/mac/Documents/Georgie Roblox Projects/makayla-horror-prototype");assert.equal(first.restorationReceipt.identityPreserved,true);assert.equal(first.restorationReceipt.newJobIdCreated,false);assert.equal(second.resumeCount,1);
  assert.equal((await listMacJobs("primary",500)).filter(item=>item.id===jobId).length,1);
});

test("missing Makayla identity restoration rejects scope expansion",async()=>{
  const planId="f4977010-f9e2-41be-ae0f-955702e45917",approvalId="3a5369b0-1caa-4a07-bda1-fd73e74bfc24";
  assert.equal(await recoverLongRunningMacJob("primary-mac","idem-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",{expectedAction:"roblox.play_test_validate",requiredAgentVersion:"2.2.66",governance:{planId,approvalId,idempotencyKey:`approval:${approvalId}:plan:${planId}`}}),null);
});

test("queue compaction retains pinned long-running identities beyond the recent-job window",()=>{
  const pinned={id:"idem-cb7e9b3ba3d078186977ba33a5a18acc371cb90f",action:"roblox.play_test_validate",retention:"pinned",createdAt:"2020-01-01T00:00:00.000Z"};
  const jobs=[pinned,...Array.from({length:600},(_,index)=>({id:`ordinary-${index}`,action:"system.info",createdAt:new Date(1_700_000_000_000+index).toISOString()}))];
  const compacted=compactJobStore({jobs});
  assert.equal(compacted.jobs.length,501);assert.equal(compacted.jobs[0].id,pinned.id);assert.equal(compacted.jobs.at(-1).id,"ordinary-599");
});

test("recovered Mac job import preserves identity and rejects conflicts",async()=>{
  const nonce=crypto.randomBytes(20).toString("hex"),root=`idem-${crypto.randomBytes(20).toString("hex")}`;
  const job={id:`idem-${nonce}`,userId:"primary",requestedByUserId:"primary",deviceId:"primary-mac",action:"mailbox.read_only_backfill",args:{objectiveId:`recovery-${nonce}`,authority:"read_only",recoveryRootJobId:root,recoveryGeneration:1},risk:"read",status:"queued",attempts:0,createdAt:new Date().toISOString(),availableAt:new Date().toISOString(),claimedAt:null,completedAt:null,result:null,error:null};
  assert.equal((await importRecoveredMacJob(job)).id,job.id);assert.equal((await importRecoveredMacJob(job)).id,job.id);
  await assert.rejects(()=>importRecoveredMacJob({...job,args:{...job.args,recoveryGeneration:2}}),/MAC_RECOVERY_IMPORT_LINEAGE_INVALID/);
  await assert.rejects(()=>importRecoveredMacJob({...job,status:"claimed",attempts:1,claimedAt:new Date().toISOString()}),/MAC_RECOVERY_IMPORT_STATE_REJECTED/);
});

test("failed generation-one mailbox payload is repaired in place without a new identity",async()=>{
  const nonce=crypto.randomBytes(20).toString("hex"),root=`idem-${crypto.randomBytes(20).toString("hex")}`,id=`idem-${nonce}`;
  const job={id,userId:"primary",requestedByUserId:"primary",deviceId:"primary-mac",action:"mailbox.read_only_backfill",args:{objectiveId:`recovery-${nonce}`,authority:"read_only",recoveryRootJobId:root,recoveryGeneration:1},risk:"read",status:"queued",attempts:0,createdAt:new Date().toISOString(),availableAt:new Date().toISOString(),claimedAt:null,completedAt:null,result:null,error:null};
  await importRecoveredMacJob(job);await claimMacJobs("primary-mac",100);await completeMacJob("primary-mac",id,{error:"MAILBOX_BRIDGE_AUTHORIZATION_FAILED"});
  const repaired=await repairRecoveredMailboxPayload("primary-mac",id,{objectiveId:job.args.objectiveId,operation:"connection_verify_and_backfill",mailboxes:["submissions@sierramarketinginc.com","jasonsierra@sierramarketinginc.com"],batchLimit:25});assert.equal(repaired.id,id);assert.equal(repaired.args.recoveryGeneration,1);assert.equal(repaired.status,"queued");assert.equal(repaired.repairHistory.at(-1).reason,"missing_read_only_mailbox_scope_repaired");
});

test("approved Mac dispatch is single-flight and carries a durable receipt",async()=>{
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,userId=`dispatch-user-${nonce}`,deviceId=`dispatch-mac-${nonce}`;
  const key=`approval:test:${nonce}`;
  const first=await enqueueMacJob({userId,deviceId,action:"system.info",idempotencyKey:key,approvalId:"approval-1",planId:"plan-1"});
  const second=await enqueueMacJob({userId,deviceId,action:"system.info",idempotencyKey:key,approvalId:"approval-1",planId:"plan-1"});
  assert.equal(second.id,first.id);assert.match(first.id,/^idem-[a-f0-9]{40}$/);assert.equal(first.dispatchReceipt.jobId,first.id);assert.equal(first.dispatchReceipt.idempotencyKey,key);
  const claimed=await claimMacJobs(deviceId,100);const job=claimed.find(item=>item.id===first.id);assert.ok(job);assert.equal(job.status,"claimed");assert.equal(job.dispatchReceipt.deviceId,deviceId);
  const completed=await completeMacJob(deviceId,first.id,{result:{ok:true}});assert.equal(completed.status,"completed");
  const persisted=(await listMacJobs(userId,100)).find(item=>item.id===first.id);assert.equal(persisted.status,"completed");
});

test("version-repaired mailbox job resumes with the same identity and immutable failure history",async()=>{
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,deviceId=`resume-mac-${nonce}`,objectiveId=`objective-${nonce}`;
  const job=await enqueueMacJob({userId:`resume-user-${nonce}`,deviceId,action:"mailbox.read_only_backfill",args:{objectiveId,authority:"read_only"},risk:"read",idempotencyKey:`resume-${nonce}`,maxAttempts:1});
  await claimMacJobs(deviceId,1);const failed=await completeMacJob(deviceId,job.id,{error:"Unsupported Mac action: mailbox.read_only_backfill"});assert.equal(failed.status,"failed");
  const resumed=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill"});
  assert.equal(resumed.id,job.id);assert.equal(resumed.idempotencyKey,job.idempotencyKey);assert.equal(resumed.status,"queued");assert.equal(resumed.resumeCount,1);assert.equal(resumed.resumeHistory.length,1);assert.equal(resumed.resumeHistory[0].error,"Unsupported Mac action: mailbox.read_only_backfill");assert.ok(resumed.maxAttempts>=resumed.attempts+5);
});

test("same-job resume rejects cross-objective, wrong-action, and completed jobs",async()=>{
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,deviceId=`resume-isolation-${nonce}`,objectiveId=`objective-${nonce}`;
  const failedJob=await enqueueMacJob({userId:`resume-isolation-user-${nonce}`,deviceId,action:"mailbox.read_only_backfill",args:{objectiveId,authority:"read_only"},risk:"read",idempotencyKey:`resume-isolation-${nonce}`,maxAttempts:1});
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,failedJob.id,{error:"Unsupported Mac action: mailbox.read_only_backfill"});
  await assert.rejects(()=>resumeFailedMacJob(deviceId,failedJob.id,{objectiveId:"other-objective",expectedAction:"mailbox.read_only_backfill"}),/MAC_JOB_OBJECTIVE_MISMATCH/);
  await assert.rejects(()=>resumeFailedMacJob(deviceId,failedJob.id,{objectiveId,expectedAction:"browser.workflow"}),/MAC_JOB_ACTION_MISMATCH/);
  const completedJob=await enqueueMacJob({userId:`resume-completed-user-${nonce}`,deviceId,action:"mailbox.read_only_backfill",args:{objectiveId,authority:"read_only"},risk:"read",idempotencyKey:`resume-completed-${nonce}`});
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,completedJob.id,{result:{ok:true}});
  await assert.rejects(()=>resumeFailedMacJob(deviceId,completedJob.id,{objectiveId,expectedAction:"mailbox.read_only_backfill"}),/MAC_JOB_NOT_RESUMABLE/);
});

test("each verified identity-root handler reopens the exact exhausted mailbox job once",async()=>{
 for(const version of ["2.2.4","2.2.5","2.2.6","2.2.7","2.2.8","2.2.9","2.2.10"]){
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,deviceId=`verified-handler-${nonce}`,objectiveId=`objective-${nonce}`;
  const job=await enqueueMacJob({userId:`verified-handler-user-${nonce}`,deviceId,action:"mailbox.read_only_backfill",args:{objectiveId,authority:"read_only"},risk:"read",idempotencyKey:`verified-handler-${nonce}`,maxAttempts:1});
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,job.id,{error:"NEO_MAILBOX_IDENTITY_NOT_VERIFIED: submissions@sierramarketinginc.com: old handler"});
  const resumed=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill",verifiedAgentVersion:version});
  assert.equal(resumed.id,job.id);assert.equal(resumed.status,"queued");assert.equal(resumed.resumeHistory.at(-1).reason,`neo_identity_root_${version.replace(/\./g,"_")}_verified`);
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,job.id,{error:"NEO_MAILBOX_IDENTITY_NOT_VERIFIED: submissions@sierramarketinginc.com: still ambiguous"});
  const replacement=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill",verifiedAgentVersion:version});
  assert.notEqual(replacement.id,job.id);assert.equal(replacement.status,"queued");assert.equal(replacement.args.recoveryRootJobId,job.id);assert.equal(replacement.args.recoveryGeneration,1);assert.equal(replacement.replacementOf.replacesJobId,job.id);
  const duplicate=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill",verifiedAgentVersion:version});assert.equal(duplicate.id,replacement.id);
 }
});

test("completed empty Apple Mail miss resumes in place after the NEO reader is deployed",async()=>{
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,deviceId=`resume-neo-${nonce}`,objectiveId=`objective-${nonce}`;
  const job=await enqueueMacJob({userId:`resume-neo-user-${nonce}`,deviceId,action:"mailbox.read_only_backfill",args:{objectiveId,authority:"read_only"},risk:"read",idempotencyKey:`resume-neo-${nonce}`});
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,job.id,{result:{mailboxEvidenceBatch:{packets:[],cursor:{}},connection:{a:{connected:false,error:"configured account not found"},b:{connected:false,error:"configured account not found"}}}});
  const resumed=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill"});
  assert.equal(resumed.id,job.id);assert.equal(resumed.status,"queued");assert.equal(resumed.resumeHistory.at(-1).fromStatus,"completed");assert.equal(resumed.resumeHistory.at(-1).reason,"legacy_reader_replaced");assert.match(resumed.resumeHistory.at(-1).resultHash,/^[a-f0-9]{64}$/);
});

test("single-tab NEO repair permits one exact fail-closed identity retry only after legacy-reader lineage",()=>{
  const base={status:"failed",error:"NEO_MAILBOX_IDENTITY_NOT_VERIFIED: submissions@sierramarketinginc.com",resumeHistory:[{reason:"legacy_reader_replaced"}]};
  assert.equal(versionRecoverableMailboxJob(base),"neo_single_tab_reader_repaired");
  assert.equal(versionRecoverableMailboxJob({...base,resumeHistory:[]}),null);
  assert.equal(versionRecoverableMailboxJob({...base,error:"NEO_MAILBOX_IDENTITY_NOT_VERIFIED: other@example.com"}),null);
  const afterSingleTab={...base,resumeHistory:[...base.resumeHistory,{reason:"neo_single_tab_reader_repaired"}]};
  assert.equal(versionRecoverableMailboxJob(afterSingleTab),"neo_account_rail_reader_repaired");
  const afterAccountRail={...base,resumeHistory:[...afterSingleTab.resumeHistory,{reason:"neo_account_rail_reader_repaired"}]};
  assert.equal(versionRecoverableMailboxJob(afterAccountRail),"neo_envelope_bound_reader_repaired");
  const afterEnvelope={...afterAccountRail,resumeHistory:[...afterAccountRail.resumeHistory,{reason:"neo_envelope_bound_reader_repaired"}]};
  assert.equal(versionRecoverableMailboxJob(afterEnvelope),"neo_full_body_reader_repaired");
  assert.equal(versionRecoverableMailboxJob({...afterEnvelope,resumeHistory:[...afterEnvelope.resumeHistory,{reason:"neo_full_body_reader_repaired"}]}),null);
});

test("same objective can replace one completed snippet batch with the full-body gate",()=>{
  const job={status:"completed",result:{mailboxEvidenceBatch:{packets:[{bodyComplete:false}],cursor:{}}},resumeHistory:[]};
  assert.equal(versionRecoverableMailboxJob(job),"neo_full_body_reader_repaired");
  assert.equal(versionRecoverableMailboxJob({...job,resumeHistory:[{reason:"neo_full_body_reader_repaired"}]}),null);
});

test("completed empty verified NEO immutable-id miss reopens exactly once",async()=>{
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,deviceId=`resume-id-${nonce}`,objectiveId=`objective-${nonce}`;
  const job=await enqueueMacJob({userId:`resume-id-user-${nonce}`,deviceId,action:"mailbox.read_only_backfill",args:{objectiveId,authority:"read_only"},risk:"read",idempotencyKey:`resume-id-${nonce}`});
  const emptyIdResult={mailboxEvidenceBatch:{packets:[],cursor:{}},connection:{submissions:{connected:true,provider:"neo_browser",readOnly:true,rejected:["missing immutable message id"]},jason:{connected:true,provider:"neo_browser",readOnly:true,rejected:["missing immutable message id"]}}};
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,job.id,{result:emptyIdResult});
  const resumed=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill",verifiedAgentVersion:"2.2.10"});
  assert.equal(resumed.id,job.id);assert.equal(resumed.status,"queued");assert.equal(resumed.resumeHistory.at(-1).reason,"neo_immutable_id_reader_repaired");
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,job.id,{result:emptyIdResult});
  const runtimeResumed=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill",verifiedAgentVersion:"2.2.11"});assert.equal(runtimeResumed.resumeHistory.at(-1).reason,"neo_runtime_state_reader_repaired");
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,job.id,{result:emptyIdResult});
  const networkResumed=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill",verifiedAgentVersion:"2.2.12"});assert.equal(networkResumed.resumeHistory.at(-1).reason,"neo_network_cache_reader_repaired");
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,job.id,{result:emptyIdResult});
  await assert.rejects(()=>resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill",verifiedAgentVersion:"2.2.12"}),/MAC_JOB_NOT_RESUMABLE: completed/);
  const control={status:"completed",result:{mailboxEvidenceBatch:{packets:[],cursor:{}},connection:{submissions:{connected:true,provider:"neo_browser",readOnly:true,rejected:[]}}},resumeHistory:[]};
  assert.equal(versionRecoverableMailboxJob(control),null);
});

test("runtime-state identifier repair reopens only after immutable-ID repair and only once",()=>{
  const result={mailboxEvidenceBatch:{packets:[],cursor:{}},connection:{a:{connected:true,provider:"neo_browser",readOnly:true,rejected:["missing immutable message id"]},b:{connected:true,provider:"neo_browser",readOnly:true,rejected:["missing immutable message id"]}}};
  const afterImmutable={status:"completed",result,resumeHistory:[{reason:"neo_immutable_id_reader_repaired"}]};
  assert.equal(versionRecoverableMailboxJob(afterImmutable),"neo_runtime_state_reader_repaired");
  assert.equal(versionRecoverableMailboxJob({...afterImmutable,resumeHistory:[...afterImmutable.resumeHistory,{reason:"neo_runtime_state_reader_repaired"}]}),"neo_network_cache_reader_repaired");
  assert.equal(versionRecoverableMailboxJob({...afterImmutable,result:{...result,connection:{a:{connected:true,provider:"neo_browser",readOnly:true,rejected:[]}}}}),null);
});

test("network-cache reader repair follows runtime-state lineage once",()=>{
 const result={mailboxEvidenceBatch:{packets:[],cursor:{}},connection:{a:{connected:true,provider:"neo_browser",readOnly:true,rejected:["missing immutable message id"]},b:{connected:true,provider:"neo_browser",readOnly:true,rejected:["missing immutable message id"]}}};
 const job={status:"completed",result,resumeHistory:[{reason:"neo_immutable_id_reader_repaired"},{reason:"neo_runtime_state_reader_repaired"}]};
 assert.equal(versionRecoverableMailboxJob(job),"neo_network_cache_reader_repaired");
 assert.equal(versionRecoverableMailboxJob({...job,resumeHistory:[...job.resumeHistory,{reason:"neo_network_cache_reader_repaired"}]}),null);
});

test("temporary Mac delivery failures retry and missing receipts raise a durable alert",async()=>{
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,userId=`test-${nonce}`,deviceId=`retry-mac-${nonce}`;
  const key=`approval:retry:${nonce}`,job=await enqueueMacJob({userId,deviceId,action:"system.info",idempotencyKey:key,approvalId:"approval-2",planId:"plan-2"});
  const claimed=(await claimMacJobs(deviceId,5)).find(item=>item.id===job.id);assert.ok(claimed);
  const retried=await completeMacJob(deviceId,job.id,{error:"temporary delivery failure"});assert.equal(retried.status,"queued");assert.ok(new Date(retried.availableAt)>new Date(retried.claimedAt));
  const alerts=await reconcileMacDispatches({nowMs:new Date(retried.availableAt).getTime()+60_001});const alert=alerts.find(item=>item.jobId===job.id);assert.equal(alert?.code,"MAC_DISPATCH_RECEIPT_MISSING");
  const persisted=(await listMacJobs(userId,100)).find(item=>item.id===job.id);assert.equal(persisted.alert.code,"MAC_DISPATCH_RECEIPT_MISSING");
});

test("non-transient NEO identity failures stop immediately at the exact resume point",async()=>{
  const deviceId="identity-fail-mac",objectiveId="SIERRA-LI-MBX-20260823-001";
  const job=await enqueueMacJob({userId:"primary",deviceId,action:"mailbox.read_only_backfill",args:{objectiveId,authority:"read_only",checkpoint:"connection_verification"},risk:"read",idempotencyKey:`identity-fail-${Date.now()}`,maxAttempts:5});
  await claimMacJobs(deviceId,1);
  const failed=await completeMacJob(deviceId,job.id,{error:"NEO_MAILBOX_IDENTITY_NOT_VERIFIED: submissions@sierramarketinginc.com"});
  assert.equal(failed.status,"failed");
  assert.equal(failed.attempts,1);
  assert.equal(failed.args.checkpoint,"connection_verification");
});


test("failed non-resumable mailbox attempt creates exactly one fenced replacement",async()=>{
  const nonce=`${Date.now()}-${Math.random().toString(16).slice(2)}`,deviceId=`replacement-${nonce}`,objectiveId=`objective-${nonce}`;
  const job=await enqueueMacJob({userId:`replacement-user-${nonce}`,deviceId,action:"mailbox.read_only_backfill",args:{objectiveId,authority:"read_only",checkpoint:"connection_verification"},risk:"read",idempotencyKey:`replacement-${nonce}`,maxAttempts:1});
  await claimMacJobs(deviceId,1);await completeMacJob(deviceId,job.id,{error:"PERMANENT_PROVIDER_FAILURE"});
  const replacement=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill"});
  const duplicate=await resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill"});
  assert.notEqual(replacement.id,job.id);assert.equal(duplicate.id,replacement.id);assert.equal(replacement.args.recoveryGeneration,1);assert.equal(replacement.args.replacesJobId,job.id);
  await assert.rejects(()=>completeMacJob(deviceId,job.id,{result:{late:true}}),/MAC_JOB_NOT_CLAIMED: failed/);
  const claimed=(await claimMacJobs(deviceId,5)).find(item=>item.id===replacement.id);assert.ok(claimed);
  const completed=await completeMacJob(deviceId,replacement.id,{result:{ok:true}});assert.equal(completed.status,"completed");
});
