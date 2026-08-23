import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

execFileSync(process.execPath,["scripts/install-infrastructure-admin-tools.mjs"],{stdio:"ignore"});

test("explicit approved Vercel invite prepares exact plan then executes through approval continuation",async()=>{
  const { deterministicToolPlan } = await import(`../src/fast-intents.js?installed=${Date.now()}`);
  const input="Execute the approved Louri onboarding now. Invite Lourib1209@gmail.com to Vercel as Developer. Treat Jason's authorization in this objective as approval.";
  const plan=deterministicToolPlan(input);
  assert.equal(plan.length,2);
  assert.equal(plan[0].tool,"approvals.prepare_plan");
  assert.equal(plan[0].args.execution.tool,"infrastructure_admin.vercel_team_member_invite");
  assert.equal(plan[0].args.execution.args.email,"Lourib1209@gmail.com");
  assert.equal(plan[0].args.execution.args.role,"DEVELOPER");
  assert.deepEqual(plan[0].args.execution.expect,{ok:true,action:"vercel.team.member.invite"});
  assert.equal(plan[0].args.execution.verification[0].tool,"infrastructure_admin.vercel_team_member_verify");
  assert.equal(plan[1].tool,"approvals.continue_latest");
});

test("Vercel provider verification tool is attached as read-only",async()=>{
  const { listToolDefinitions } = await import(`../src/tools.js?installed=${Date.now()}`);
  const verify=listToolDefinitions().find(tool=>tool.name==="infrastructure_admin.vercel_team_member_verify");
  assert.ok(verify);
  assert.equal(verify.risk,"read");
});
