import test from "node:test";
import assert from "node:assert/strict";
import { agentVersionEligible } from "../src/mac/queue.js";

test("version-fenced Mac jobs cannot be claimed by stale runtimes",()=>{
  const job={args:{requiredAgentVersion:"2.2.34"}};
  assert.equal(agentVersionEligible(job,"2.2.34"),true);
  assert.equal(agentVersionEligible(job,"2.2.32"),false);
  assert.equal(agentVersionEligible(job,""),false);
  assert.equal(agentVersionEligible({args:{}},"2.2.32"),true);
});
