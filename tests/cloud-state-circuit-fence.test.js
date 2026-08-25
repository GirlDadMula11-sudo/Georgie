import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function loadCloudState(fetchImpl){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"georgie-circuit-fence-"));
  process.env.GEORGIE_SUPABASE_URL="https://example.supabase.co";
  process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY="server-only-test-key";
  process.env.GEORGIE_DATA_DIR=root;
  process.env.GEORGIE_CLOUD_STATE_TIMEOUT_MS="250";
  process.env.GEORGIE_CLOUD_STATE_CONCURRENCY="1";
  process.env.GEORGIE_CLOUD_STATE_PROVIDER_COOLDOWN_MS="5000";
  global.fetch=fetchImpl;
  return import(`../src/cloud-state.js?circuit-fence=${Date.now()}`);
}

test("queued namespaces do not probe provider after first request opens global circuit",async()=>{
  let calls=0;
  const module=await loadCloudState(async()=>{calls+=1;await new Promise(resolve=>setTimeout(resolve,25));throw new TypeError("provider unavailable");});
  const results=await Promise.all([
    module.readCloudState("u1","a",{a:1}),
    module.readCloudState("u1","b",{b:1}),
    module.readCloudState("u1","c",{c:1})
  ]);
  assert.deepEqual(results,[{a:1},{b:1},{c:1}]);
  assert.equal(calls,1);
  assert.equal(module.cloudStateStatus().providerCircuitOpen,true);
});
