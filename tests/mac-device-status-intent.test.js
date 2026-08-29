import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { verifiedDirectResponse } from "../src/v2-turn-engine.js";

test("primary Mac heartbeat routes directly to mac.devices",()=>{
  const actions=deterministicToolPlan("Show the primary Mac device heartbeat and exact Mac-agent version. Do not create a plan or queue any job.");
  assert.deepEqual(actions.map(item=>item.tool),["mac.devices"]);
});

test("Mac recovery plan cannot be swallowed by heartbeat status",()=>{
  const actions=deterministicToolPlan("Prepare one bounded recovery plan for developer.update_restart_from_main at /Users/mac/Georgie. Update primary-mac to agent 2.2.37 and verify a fresh heartbeat. Do not create or duplicate any Roblox build job.");
  assert.equal(actions[0]?.tool,"approvals.prepare_plan");
  assert.equal(actions[0]?.args?.execution?.tool,"developer.update_restart_from_main");
});

test("standalone Mac heartbeat reports agent version deterministically",()=>{
  const response=verifiedDirectResponse("Show primary Mac heartbeat",[{ok:true,tool:"mac.devices",result:[{deviceId:"primary-mac",online:true,agentVersion:"2.2.37",lastSeenAt:"2026-08-29T23:00:00.000Z",hostname:"Jason-Mac"}]}]);
  assert.match(response.text,/Agent version: 2\.2\.37/);
  assert.match(response.text,/Online: yes/);
  assert.equal(response.terminalState,"verified");
});

test("Mac app commands retain their normal response path",()=>{
  const response=verifiedDirectResponse("Open Notes",[{ok:true,tool:"mac.devices",result:[{deviceId:"primary-mac",online:true}]},{ok:true,tool:"mac.open_app",result:{args:{app:"Notes"}}}]);
  assert.match(response.text,/open Notes/i);
});
