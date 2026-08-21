import test from "node:test";
import assert from "node:assert/strict";
import { maintenanceControlBrief } from "../src/maintenance-sentinel.js";

test("maintenance brief fails closed when no current evidence exists",()=>{
  const brief=maintenanceControlBrief({});
  assert.equal(brief.status,"unknown");
  assert.match(brief.headline,/not completed a current maintenance check/i);
});

test("maintenance brief reports degraded evidence without claiming health",()=>{
  const brief=maintenanceControlBrief({observedAt:new Date().toISOString(),sources:[{name:"sierra_health",ok:false}],signals:[{source:"sierra_health",path:"connection",value:1}],repairAuthority:{boundedExecution:false}});
  assert.equal(brief.status,"coverage_degraded");
  assert.doesNotMatch(brief.headline,/healthy/i);
  assert.match(brief.nextMove,/approval-gated/i);
});

test("verified bounded outcome is stated precisely",()=>{
  const brief=maintenanceControlBrief({observedAt:new Date().toISOString(),sources:[{name:"deployment_providers",ok:true}],signals:[],repairs:[{runbookId:"provider.observability.refresh",result:"verified"}]});
  assert.equal(brief.status,"healthy_snapshot");
  assert.match(brief.nextMove,/passed verification/i);
});
