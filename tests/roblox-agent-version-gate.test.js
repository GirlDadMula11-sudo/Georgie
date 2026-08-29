import test from "node:test";
import assert from "node:assert/strict";
import { agentVersionEligible } from "../src/mac/queue.js";

test("old Mac agent cannot claim the Roblox prototype after update dispatch", () => {
  const job={args:{requiredAgentVersion:"2.2.37"}};
  assert.equal(agentVersionEligible(job,"2.2.36"),false);
  assert.equal(agentVersionEligible(job,"2.2.37"),true);
});
