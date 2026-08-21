import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";
import { multiSystemAuditResponse, verifiedMultiSystemRepairPlan } from "../src/multi-system-audit.js";

const prompt="Access the Mac desktop, go through all tabs and diagnose everything related to Sierra including Supabase GitHub Vercel Render Partner Portal and CapitalApply. Make sure the entire platform is functioning properly.";

test("broad Mac and Sierra audit routes to every authoritative system lane",()=>{
  const tools=deterministicToolPlan(prompt).map(item=>item.tool);
  assert.deepEqual(tools,["mac.browser_inspect","system.supabase","system.github","system.vercel","system.render","sierra.health","sierra.infrastructure","sierra.apply_inventory","sierra.reconciliation_invariant"]);
});

test("unfinished approved tabs and provider checks fail the objective closed",()=>{
  const response=multiSystemAuditResponse([
    {ok:true,tool:"mac.browser_inspect",result:{status:"completed",result:{tabs:[
      {browser:"Google Chrome",title:"Sierra Partner Portal",url:"https://partners.sierramarketinginc.com",contentApproved:true,content:null,contentError:"Chrome JavaScript from Apple Events is disabled"},
      {browser:"Google Chrome",title:"CapitalApply",url:"https://capitalapply.sierramarketinginc.com",contentApproved:true,content:"Application page"}
    ]}}},
    {ok:true,tool:"system.supabase",result:{health_status:"healthy"}},
    {ok:false,tool:"system.github",error:"GEORGIE_GITHUB_TOKEN is missing"},
    {ok:true,tool:"system.vercel",result:{errorCount:0,latestDeployment:{state:"READY"}}},
    {ok:true,tool:"system.render",result:{errorCount:0,latestDeployment:{status:"live"}}},
    {ok:true,tool:"sierra.health",result:{health_status:"healthy",failed_pipeline_stages:0}},
    {ok:true,tool:"sierra.infrastructure",result:{status:"healthy"}},
    {ok:true,tool:"sierra.apply_inventory",result:[]},
    {ok:true,tool:"sierra.reconciliation_invariant",result:{status:"healthy"}}
  ]);
  assert.equal(response.completed,false);
  assert.equal(response.terminalState,"blocked");
  assert.match(response.text,/GitHub: Blocked/);
  assert.match(response.text,/Sierra Partner Portal: Blocked — Chrome JavaScript from Apple Events is disabled/);
  assert.match(response.text,/No overall completion is claimed/);
});

test("a missing required lane can never produce overall completion",()=>{
  const response=multiSystemAuditResponse([
    {ok:true,tool:"mac.browser_inspect",result:{status:"completed",result:{tabs:[{browser:"Safari",title:"Partner Portal",url:"https://partners.sierramarketinginc.com",contentApproved:true,content:"ok"}]}}},
    {ok:true,tool:"system.supabase",result:{status:"healthy"}},
    {ok:true,tool:"system.github",result:{latestRun:{status:"completed",conclusion:"success"}}}
  ]);
  assert.equal(response.completed,false);
  assert.match(response.text,/Required checks not run/);
});

test("a bounded approval plan is prepared only from a verified Sierra defect",()=>{
  const plan=verifiedMultiSystemRepairPlan([
    {ok:true,tool:"system.supabase",result:{status:"healthy"}},
    {ok:true,tool:"system.github",result:{latestRun:{status:"completed",conclusion:"success"}}},
    {ok:true,tool:"sierra.health",result:{health_status:"unhealthy"}},
    {ok:true,tool:"sierra.infrastructure",result:{status:"healthy"}},
    {ok:true,tool:"sierra.reconciliation_invariant",result:{status:"healthy"}}
  ]);
  assert.equal(plan.execution.tool,"system.reconciliation_execute_bounded");
  assert.equal(verifiedMultiSystemRepairPlan([{ok:true,tool:"system.supabase"},{ok:true,tool:"system.github"},{ok:false,tool:"sierra.health",error:"not returned"}]),null);
});
