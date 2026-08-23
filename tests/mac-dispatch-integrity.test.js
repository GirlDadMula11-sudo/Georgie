import test from "node:test";
import assert from "node:assert/strict";
import { enqueueMacJob, claimMacJobs, completeMacJob, listMacJobs, reconcileMacDispatches, resumeFailedMacJob, versionRecoverableMailboxJob } from "../src/mac/queue.js";

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
  await assert.rejects(()=>resumeFailedMacJob(deviceId,job.id,{objectiveId,expectedAction:"mailbox.read_only_backfill",verifiedAgentVersion:version}),/MAC_JOB_NOT_RESUMABLE/);
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
