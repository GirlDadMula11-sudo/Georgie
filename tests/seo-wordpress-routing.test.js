import test from "node:test";
import assert from "node:assert/strict";
import { deterministicToolPlan } from "../src/fast-intents.js";

test("WordPress sitemap repairs bypass Sierra multi-system audit routing", () => {
  const plan = deterministicToolPlan(
    "Use the Mac browser to repair the Sierra WordPress Rank Math sitemap cache and verify all SEO URLs."
  );
  assert.deepEqual(plan, []);
});

test("broad Sierra Mac health audits still use the multi-system audit route", () => {
  const plan = deterministicToolPlan(
    "Use the Mac browser to diagnose whether all Sierra platforms are functioning."
  );
  assert.equal(plan[0]?.tool, "mac.browser_inspect");
  assert.equal(plan[0]?.args?.scope, "sierra_multi_system");
});
