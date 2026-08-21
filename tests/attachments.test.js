import test from "node:test";
import assert from "node:assert/strict";
import { attachmentModelParts, missingBucketResponse, publicAttachmentManifest, validateAttachment } from "../src/attachments.js";

test("validates a genuine PDF and produces a stable digest",()=>{
  const result=validateAttachment({originalname:"application.pdf",mimetype:"application/pdf",buffer:Buffer.from("%PDF-1.7\ncontrolled evidence")});
  assert.equal(result.mimeType,"application/pdf");
  assert.match(result.sha256,/^[a-f0-9]{64}$/);
});

test("rejects deceptive executable attachments",()=>{
  assert.throws(()=>validateAttachment({originalname:"application.pdf.exe",mimetype:"application/octet-stream",buffer:Buffer.from("MZ")}),/not a supported/);
});

test("rejects a file whose bytes do not match its declared image type",()=>{
  assert.throws(()=>validateAttachment({originalname:"evidence.png",mimetype:"image/png",buffer:Buffer.from("not a png")}),/did not match/);
});

test("creates supported multimodal model parts and hides private storage paths",()=>{
  const attachments=[{id:"1",name:"statement.pdf",mimeType:"application/pdf",size:12,sha256:"a".repeat(64),storagePath:"private/path",bucket:"private",createdAt:"2026-08-20T00:00:00.000Z",buffer:Buffer.from("%PDF-")}];
  const parts=attachmentModelParts(attachments);
  assert.equal(parts[0].type,"input_file");
  assert.match(parts[0].file_data,/^data:application\/pdf;base64,/);
  const manifest=publicAttachmentManifest(attachments)[0];
  assert.equal(manifest.storagePath,undefined);
  assert.equal(manifest.bucket,undefined);
  assert.equal(manifest.buffer,undefined);
});

test("classifies Supabase's 400 bucket-not-found response without masking other 400 errors",()=>{
  assert.equal(missingBucketResponse(400,JSON.stringify({statusCode:"404",error:"Bucket not found",message:"Bucket not found"})),true);
  assert.equal(missingBucketResponse(404,""),true);
  assert.equal(missingBucketResponse(400,JSON.stringify({message:"Invalid API key"})),false);
  assert.equal(missingBucketResponse(401,"Bucket not found"),false);
});
