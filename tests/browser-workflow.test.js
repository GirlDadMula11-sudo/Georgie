import test from "node:test";
import assert from "node:assert/strict";
import { supabaseAuthHardeningPlan, validateBrowserWorkflow } from "../src/browser-workflow.js";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("Supabase browser workflow is project and setting scoped",()=>{
  const plan=supabaseAuthHardeningPlan("quzhzefkwymxcaylmozp");assert.equal(plan.execution.tool,"mac.browser_workflow");assert.deepEqual(plan.execution.args.workflow.allowedSettings,["auth.leaked_password_protection","auth.database_connection_allocation"]);assert.ok(plan.execution.args.workflow.steps.every(step=>step.action!=="ui.click"));
});

test("browser workflow rejects cross-project URLs and unapproved settings",()=>{
  assert.throws(()=>validateBrowserWorkflow({provider:"supabase",projectId:"quzhzefkwymxcaylmozp",allowedSettings:["auth.smtp"],steps:[{action:"open_url",url:"https://supabase.com/dashboard/project/quzhzefkwymxcaylmozp"}]}),/unapproved/);
  assert.throws(()=>validateBrowserWorkflow({provider:"supabase",projectId:"quzhzefkwymxcaylmozp",allowedSettings:["auth.leaked_password_protection"],steps:[{action:"open_url",url:"https://supabase.com/dashboard/project/aaaaaaaaaaaaaaaaaaaa"}]}),/outside/);
});

test("replacement-plan language invokes the governed registry deterministically",()=>{
  const [action]=deterministicToolPlan("Create a replacement governed Supabase plan to enable leaked-password protection and change the fixed 10 connection allocation to percentage mode.");assert.equal(action.tool,"approvals.prepare_plan");assert.equal(action.args.execution.tool,"mac.browser_workflow");
});

test("exact plan approval routes by both immutable IDs",()=>{
  const planId="ff855750-b4d1-425f-adb5-a972849196c4",approvalId="06216bba-d516-4217-9f8e-a091d4c48411";assert.deepEqual(deterministicToolPlan(`Approved plan ${planId} under approval ${approvalId}`),[{tool:"approvals.approve_plan",args:{planId,approvalId}}]);
});
