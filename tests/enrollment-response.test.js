import test from "node:test";
import assert from "node:assert/strict";
import { verifiedEnrollmentResponse } from "../src/enrollment-response.js";

test("a successful enrollment action displays the issued code deterministically",()=>{
  const result=verifiedEnrollmentResponse("Create a one-time enrollment code for my Mac.",[{ok:true,tool:"system.create_enrollment_code",result:{code:"TEST-CODE",expiresAt:"2026-08-20T21:30:00.000Z",oneTime:true}}]);
  assert.match(result.text,/TEST-CODE/);
  assert.equal(result.sensitiveResponse,true);
  assert.equal(result.model,"deterministic-verified-action");
});

test("a failed enrollment action never claims a code was issued",()=>{
  const result=verifiedEnrollmentResponse("Create an enrollment code",[{ok:false,tool:"system.create_enrollment_code",error:"store unavailable"}]);
  assert.match(result.text,/No valid code was issued/);
  assert.doesNotMatch(result.text,/tool isn.t available/i);
});
