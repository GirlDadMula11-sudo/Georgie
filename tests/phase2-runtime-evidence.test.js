import test from "node:test";
import assert from "node:assert/strict";
import { phase2Foundation } from "../src/phase2-foundation.js";

test("Render runtime commit proves the contract executing in production without a stale registry flag", () => {
  const value = phase2Foundation({ runtimeCommit: "57442888f57d156e2456c5ef46111f815a7a1aa3" });
  assert.equal(value.status, "contract_deployed");
  assert.equal(value.deployment.deployed, true);
  assert.equal(value.deployment.evidenceSource, "render_runtime");
  assert.match(value.implementationState, /canary.*read.back/i);
});
