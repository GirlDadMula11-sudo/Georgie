import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAIControlEnvelope, parseAIControlEnvelopes, serializeAIControlEnvelope } from "../src/ai-control-envelope.js";

test("typed AI control envelope round-trips with stable execution identity",()=>{
  const input={commandId:"cmd_louri_vercel_001",objectiveId:"obj_louri_onboarding",sender:"chatgpt",recipient:"georgie",tool:"infrastructure_admin.vercel_team_member_invite",args:{email:"Lourib1209@gmail.com",role:"DEVELOPER"},risk:"external_side_effect",requestedAuthority:"approved_external_side_effect",approvalRef:"approval_louri_onboarding_001",idempotencyKey:"louri:vercel:invite:v1",mutationScope:"vercel:team:members:louri",acceptanceCriteria:["Provider accepts invitation"],correlationId:"corr_louri_onboarding_001",verification:{tool:"infrastructure_admin.vercel_team_members_list",args:{}}};
  const wire=serializeAIControlEnvelope(input),parsed=parseAIControlEnvelopes(wire);
  assert.equal(parsed.length,1);assert.equal(parsed[0].ok,true);assert.equal(parsed[0].envelope.commandId,input.commandId);assert.equal(parsed[0].envelope.tool,input.tool);assert.equal(parsed[0].envelope.idempotencyKey,input.idempotencyKey);assert.equal(parsed[0].envelope.verification.tool,"infrastructure_admin.vercel_team_members_list");
});

test("secret-shaped fields fail closed",()=>{
  assert.throws(()=>normalizeAIControlEnvelope({commandId:"cmd_secret_001",objectiveId:"obj_secret",sender:"chatgpt",recipient:"georgie",tool:"system.github",args:{api_token:"do-not-store"}}),/secret-shaped/i);
});

test("wrong sender or recipient cannot become executable authority",()=>{
  assert.throws(()=>normalizeAIControlEnvelope({commandId:"cmd_bad_sender",objectiveId:"obj_bad",sender:"unknown",recipient:"georgie",tool:"system.github",args:{}}),/sender\/recipient/i);
  assert.throws(()=>normalizeAIControlEnvelope({commandId:"cmd_bad_target",objectiveId:"obj_bad",sender:"chatgpt",recipient:"someone-else",tool:"system.github",args:{}}),/sender\/recipient/i);
});

test("duplicate wire markers preserve one deterministic idempotency identity",()=>{
  const base={commandId:"cmd_duplicate_001",objectiveId:"obj_duplicate",sender:"chatgpt",recipient:"georgie",tool:"system.github",args:{},idempotencyKey:"dup:key:001"};
  const text=`${serializeAIControlEnvelope(base)}\n${serializeAIControlEnvelope(base)}`;const parsed=parseAIControlEnvelopes(text);
  assert.equal(parsed.length,2);assert.equal(parsed[0].envelope.idempotencyKey,parsed[1].envelope.idempotencyKey);assert.equal(parsed[0].envelope.integrityHash,parsed[1].envelope.integrityHash);
});
