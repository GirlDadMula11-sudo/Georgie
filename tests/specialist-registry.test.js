import test from "node:test";
import assert from "node:assert/strict";
import { classifySpecialistNeeds, listSpecialists, selectSpecialist } from "../src/specialist-registry.js";

test("specialist registry exposes bounded named workers",()=>{
  const workers=listSpecialists();
  assert.ok(workers.length>=7);
  assert.ok(workers.some(worker=>worker.id==="infra-engineer"));
  assert.ok(workers.some(worker=>worker.id==="document-worker"));
  assert.ok(workers.every(worker=>Array.isArray(worker.capabilities)&&worker.capabilities.length>0));
});

test("repository deployment work selects infrastructure engineering",()=>{
  const result=selectSpecialist({domain:"technical",text:"Inspect the GitHub repo and diagnose the Render deployment worker"});
  assert.equal(result.specialist.id,"infra-engineer");
  assert.ok(result.requiredCapabilities.includes("repository_inspection"));
});

test("CM-100 document work selects the document specialist",()=>{
  const result=selectSpecialist({domain:"sierra",text:"Repair CM-100 document intake and verify the application artifact"});
  assert.equal(result.specialist.id,"document-worker");
  assert.ok(result.requiredCapabilities.includes("document_intake"));
});

test("outreach work selects the outreach specialist",()=>{
  const result=selectSpecialist({domain:"sierra",text:"Inspect Smartlead campaign deliverability and bounce metrics"});
  assert.equal(result.specialist.id,"outreach-worker");
  assert.deepEqual(classifySpecialistNeeds({domain:"sierra",text:"Smartlead campaign"}).requiredCapabilities,["smartlead"]);
});
