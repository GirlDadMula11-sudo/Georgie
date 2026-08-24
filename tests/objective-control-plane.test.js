import test from "node:test";
import assert from "node:assert/strict";

process.env.GEORGIE_SUPABASE_URL = "https://example.supabase.test";
process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.GEORGIE_DATA_DIR = `/tmp/georgie-objective-tests-${process.pid}`;

const store = new Map();
globalThis.fetch = async (url, options={}) => {
  const rpc = String(url).split("/").pop();
  const body = JSON.parse(options.body || "{}");
  const key = `${body.p_user_id}\0${body.p_namespace}`;
  if (rpc === "georgie_get_operational_state") return new Response(JSON.stringify(store.get(key) || {}), { status:200, headers:{"content-type":"application/json"} });
  if (rpc === "georgie_put_operational_state") { store.set(key, structuredClone(body.p_state)); return new Response(JSON.stringify(true), { status:200, headers:{"content-type":"application/json"} }); }
  return new Response(JSON.stringify({error:"unknown rpc"}), { status:404, headers:{"content-type":"application/json"} });
};

const cp = await import("../src/objective-control-plane.js");

test("reasoning router reserves frontier reasoning for complex work", () => {
  assert.equal(cp.routeReasoningTier({text:"what does this status mean"}).level, "L1");
  assert.equal(cp.routeReasoningTier({text:"debug this config"}).level, "L2");
  assert.equal(cp.routeReasoningTier({text:"root cause this cross-system production failure", productionImpact:true, systemCount:3}).level, "L3");
  assert.equal(cp.routeReasoningTier({text:"repair auth", productionImpact:true, consequentialAction:true, securitySensitive:true}).level, "L4");
});

test("objective creation is idempotent", async () => {
  const a = await cp.createObjective({userId:"idem",title:"Repair",instruction:"Repair the system",idempotencyKey:"same"});
  const b = await cp.createObjective({userId:"idem",title:"Repair again",instruction:"Duplicate",idempotencyKey:"same"});
  assert.equal(a.objectiveId,b.objectiveId);
});

test("completion requires evidence", async () => {
  const o = await cp.createObjective({userId:"evidence",title:"Deploy",instruction:"Deploy safely"});
  await cp.transitionObjective("evidence",o.objectiveId,"running");
  await cp.transitionObjective("evidence",o.objectiveId,"verifying");
  await assert.rejects(()=>cp.transitionObjective("evidence",o.objectiveId,"complete"),/without evidence/);
  const receipt=await cp.appendEvidence("evidence",o.objectiveId,{kind:"production_probe",summary:"Expected behavior observed",verified:true});
  assert.match(receipt.receiptId,/^rcpt_/);
  const done=await cp.transitionObjective("evidence",o.objectiveId,"complete");
  assert.equal(done.state,"complete");
});

test("lease prevents double ownership and accepts checkpoint", async () => {
  const o=await cp.createObjective({userId:"lease",title:"Long job",instruction:"Perform long job"});
  const first=await cp.acquireObjectiveLease("lease",o.objectiveId,"worker-a",{now:1_000,leaseMs:10_000});
  assert.ok(first?.token);
  assert.equal(await cp.acquireObjectiveLease("lease",o.objectiveId,"worker-b",{now:2_000,leaseMs:10_000}),null);
  const point=await cp.checkpointObjective("lease",o.objectiveId,first.token,{step:"provider_called"},{now:3_000});
  assert.equal(point.data.step,"provider_called");
});

test("expired lease and retryable failure recover to queue", async () => {
  const a=await cp.createObjective({userId:"recover",title:"Lease recovery",instruction:"Recover after worker death"});
  await cp.acquireObjectiveLease("recover",a.objectiveId,"dead-worker",{now:1_000,leaseMs:5_000});
  let recovered=await cp.recoverDueObjectives("recover",{now:7_000});
  assert.deepEqual(recovered,[a.objectiveId]);
  assert.equal((await cp.getObjective("recover",a.objectiveId)).state,"queued");

  const b=await cp.createObjective({userId:"recover",title:"Retry recovery",instruction:"Retry provider timeout"});
  await cp.transitionObjective("recover",b.objectiveId,"running",{now:10_000});
  const failed=await cp.markRetryableFailure("recover",b.objectiveId,new Error("provider timeout"),{now:11_000,baseDelayMs:1_000});
  assert.equal(failed.state,"retryable_failure");
  recovered=await cp.recoverDueObjectives("recover",{now:20_000});
  assert.ok(recovered.includes(b.objectiveId));
});

test("illegal state transitions fail closed", async () => {
  const o=await cp.createObjective({userId:"illegal",title:"Guard",instruction:"Do not skip states"});
  await assert.rejects(()=>cp.transitionObjective("illegal",o.objectiveId,"complete"),/illegal objective transition/);
});
