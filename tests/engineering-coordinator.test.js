import test from "node:test";
import assert from "node:assert/strict";
import { seedMissionWork } from "../src/engineering-coordinator.js";

test("mission seeding is idempotent and preserves the locked attack order",async()=>{
  process.env.GEORGIE_CLOUD_STATE_ENABLED="false";
  const uid=`mission-test-${Date.now()}`;
  const first=await seedMissionWork(uid),second=await seedMissionWork(uid);
  assert.equal(first.length,9);assert.equal(second.every(item=>item.status==="deduplicated"),true);
  assert.equal(first[0].item.priority,100);
  assert.match(first[1].item.objective,/Canonical document identity/i);
  assert.match(first[7].item.objective,/CapitalMatch accuracy/i);
});
