import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { deterministicToolPlan } from "../src/fast-intents.js";

const agent = await fs.readFile(new URL("../mac-agent/agent.js", import.meta.url), "utf8");
const tools = await fs.readFile(new URL("../src/tools.js", import.meta.url), "utf8");
const projectRoot = "/Users/mac/Documents/Georgie Roblox Projects/makayla-horror-prototype";

test("Mac agent performs a bounded Studio play test with six gameplay checks", () => {
  assert.match(agent, /case "roblox\.play_test_validate"/);
  for (const check of ["spawning","threeRelics","watcherChase","exitDoorUnlock","lighting","controls"]) assert.match(agent, new RegExp(`${check}:`));
  assert.match(agent, /Georgie prototype loaded:/);
  assert.match(agent, /key code 96/);
  assert.match(agent, /shift down/);
  assert.match(agent, /screenshotSha256/);
  assert.match(tools, /name:"roblox\.play_test_validate"/);
  assert.match(tools, /requiredAgentVersion:"2\.2\.41"/);
  assert.match(tools, /runtimeMarkerObserved/);
  assert.match(tools, /safeResult\.checks/);
});

test("exact play-test marker prepares one non-publishing plan", () => {
  const marker = `ROBLOX_PLAY_TEST_JSON: ${JSON.stringify({projectRoot,requiredAgentVersion:"2.2.41"})}`;
  const [action] = deterministicToolPlan(marker);
  assert.equal(action.tool, "approvals.prepare_plan");
  assert.equal(action.args.execution.tool, "roblox.play_test_validate");
  assert.equal(action.args.execution.args.projectRoot, projectRoot);
  assert.match(action.args.summary, /Do not publish or create another project/i);
});

test("play-test marker rejects path or agent expansion", () => {
  for (const request of [
    {projectRoot:"/Users/mac/Documents/Other",requiredAgentVersion:"2.2.41"},
    {projectRoot,requiredAgentVersion:"2.2.40"}
  ]) assert.deepEqual(deterministicToolPlan(`ROBLOX_PLAY_TEST_JSON: ${JSON.stringify(request)}`), []);
});
