import test from "node:test";
import assert from "node:assert/strict";
import { enqueueMacJob, claimMacJobs, completeMacJob, listMacJobs, reconcileMacDispatches } from "../src/mac/queue.js";

test("approved Mac dispatch is single-flight and carries a durable receipt",async()=>{
  const key=`approval:test:${Date.now()}`;
  const first=await enqueueMacJob({userId:"test",deviceId:"test-mac",action:"system.info",idempotencyKey:key,approvalId:"approval-1",planId:"plan-1"});
  const second=await enqueueMacJob({userId:"test",deviceId:"test-mac",action:"system.info",idempotencyKey:key,approvalId:"approval-1",planId:"plan-1"});
  assert.equal(second.id,first.id);assert.match(first.id,/^idem-[a-f0-9]{40}$/);assert.equal(first.dispatchReceipt.jobId,first.id);assert.equal(first.dispatchReceipt.idempotencyKey,key);
  const claimed=await claimMacJobs("test-mac",5);const job=claimed.find(item=>item.id===first.id);assert.ok(job);assert.equal(job.status,"claimed");assert.equal(job.dispatchReceipt.deviceId,"test-mac");
  const completed=await completeMacJob("test-mac",first.id,{result:{ok:true}});assert.equal(completed.status,"completed");
  const persisted=(await listMacJobs("test",100)).find(item=>item.id===first.id);assert.equal(persisted.status,"completed");
});

test("temporary Mac delivery failures retry and missing receipts raise a durable alert",async()=>{
  const key=`approval:retry:${Date.now()}`,job=await enqueueMacJob({userId:"test",deviceId:"retry-mac",action:"system.info",idempotencyKey:key,approvalId:"approval-2",planId:"plan-2"});
  const claimed=(await claimMacJobs("retry-mac",5)).find(item=>item.id===job.id);assert.ok(claimed);
  const retried=await completeMacJob("retry-mac",job.id,{error:"temporary delivery failure"});assert.equal(retried.status,"queued");assert.ok(new Date(retried.availableAt)>new Date(retried.claimedAt));
  const alerts=await reconcileMacDispatches({nowMs:new Date(retried.availableAt).getTime()+60_001});const alert=alerts.find(item=>item.jobId===job.id);assert.equal(alert?.code,"MAC_DISPATCH_RECEIPT_MISSING");
  const persisted=(await listMacJobs("test",100)).find(item=>item.id===job.id);assert.equal(persisted.alert.code,"MAC_DISPATCH_RECEIPT_MISSING");
});
