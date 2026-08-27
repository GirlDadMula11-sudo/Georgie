import test from "node:test";
import assert from "node:assert/strict";
import { createModelCostGovernor } from "../src/model-cost-governor.js";

test("billing exhaustion opens a circuit that blocks subsequent model calls",()=>{
  let current=Date.parse("2026-08-27T13:00:00Z");
  const governor=createModelCostGovernor({perMinute:5,perDay:20,billingCircuitMs:21_600_000,now:()=>current});
  assert.equal(governor.acquire().admitted,true);
  const failure=governor.recordFailure({status:429,message:"You have no credits remaining"});
  assert.equal(failure.billing,true);
  assert.equal(governor.status().billingCircuitOpen,true);
  assert.throws(()=>governor.acquire(),error=>error.code==="model_cost_billing_circuit");
  current+=21_600_001;
  assert.equal(governor.acquire().admitted,true);
});

test("minute and daily request budgets fail closed before another provider call",()=>{
  let current=Date.parse("2026-08-27T13:00:00Z");
  const governor=createModelCostGovernor({perMinute:2,perDay:3,now:()=>current});
  governor.acquire();governor.acquire();
  assert.throws(()=>governor.acquire(),error=>error.code==="model_cost_minute_cap");
  current+=60_001;
  governor.acquire();
  assert.throws(()=>governor.acquire(),error=>error.code==="model_cost_daily_cap");
  const status=governor.status();
  assert.equal(status.dailyRequests,3);
  assert.equal(status.blockedRequests,2);
});

test("ordinary transport failure does not falsely open the billing circuit",()=>{
  const governor=createModelCostGovernor();
  governor.acquire();
  const failure=governor.recordFailure({status:503,message:"connection reset"});
  assert.equal(failure.billing,false);
  assert.equal(governor.status().billingCircuitOpen,false);
});
