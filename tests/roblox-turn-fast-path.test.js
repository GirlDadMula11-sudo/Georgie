import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { completeTurnV2 } from "../src/v2-turn-engine.js";

test("Roblox continuation prepares its real plan before the general model", () => {
  const source=fs.readFileSync(new URL("../src/v2-turn-engine.js",import.meta.url),"utf8");
  assert.match(source,/async function robloxPlanFastPath/);
  assert.match(source,/deterministicRobloxMarker/);
  assert.match(source,/mac\.long_running_job_recover/);
  assert.match(source,/name:"approvals\.prepare_plan".*policy:"low_risk_write"/s);
  assert.ok(source.indexOf("const robloxPlan=await robloxPlanFastPath")<source.indexOf("const rawResponse=direct||await askGeorgie"));
});

test("exact Mac job receipt reads bypass unrelated conversational hydration", async () => {
  const started=Date.now();
  const result=await completeTurnV2({
    userId:`mac-receipt-fast-path-${Date.now()}`,
    sessionId:"mac-receipt-fast-path",
    input:"Read the current receipt and heartbeat for exact Mac job idem-cb7e9b3ba3d078186977ba33a5a18acc371cb90f only. Do not resume, restart, execute, or repair anything.",
    history:[],
    shouldFinalize:()=>false
  });
  assert.equal(result.engine,"unified-georgie-runtime-v1-mac-receipt-fast-path");
  assert.deepEqual(result.actions.map(action=>action.tool),["mac.job_receipt","mac.devices"]);
  assert.ok(Date.now()-started<1000,"exact Mac receipt reads must remain sub-second");
});
