import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Roblox continuation prepares its real plan before the general model", () => {
  const source=fs.readFileSync(new URL("../src/v2-turn-engine.js",import.meta.url),"utf8");
  assert.match(source,/async function robloxPlanFastPath/);
  assert.match(source,/deterministicRobloxMarker/);
  assert.match(source,/mac\.long_running_job_recover/);
  assert.match(source,/name:"approvals\.prepare_plan".*policy:"low_risk_write"/s);
  assert.ok(source.indexOf("const robloxPlan=await robloxPlanFastPath")<source.indexOf("const rawResponse=direct||await askGeorgie"));
});
