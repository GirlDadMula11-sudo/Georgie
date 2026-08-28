import test from "node:test";
import assert from "node:assert/strict";
import { robloxReadiness, validateRobloxRequest } from "../src/roblox/capability.js";
import { certifyRobloxCaseStudy } from "../src/roblox/case-study.js";
import { buildRobloxToolchainProbe } from "../src/roblox/mac-contract.js";

test("Roblox route requires exact private-development authority and primary Mac", () => {
  assert.equal(validateRobloxRequest({ operation: "sync_project", targetDevice: "primary-mac", authority: "roblox_private_development" }).accepted, true);
  assert.equal(validateRobloxRequest({ operation: "sync_project", targetDevice: "server", authority: "roblox_private_development" }).accepted, false);
  assert.equal(validateRobloxRequest({ operation: "public_publish", targetDevice: "primary-mac", authority: "roblox_private_development" }).accepted, false);
});

test("readiness stays blocked until every live prerequisite is proven", () => {
  const blocked = robloxReadiness({ macAgentOnline: true });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.missing.includes("robloxStudioInstalled"));
  const ready = robloxReadiness({
    macAgentOnline: true, robloxStudioInstalled: true, robloxStudioAuthenticated: true,
    rojoInstalled: true, luauAnalyzerInstalled: true, privateExperienceBound: true, repositoryBound: true
  });
  assert.equal(ready.ready, true);
});

test("investor claim is withheld without playable and privacy evidence", () => {
  const partial = certifyRobloxCaseStudy({ evidence: { objective: "Build a game" }, privacy: {} });
  assert.equal(partial.claimAllowed, false);
  assert.equal(partial.investorClaim, null);
});

test("complete private evidence produces a hashed certification", () => {
  const evidence = Object.fromEntries([
    "objective","acceptanceCriteria","sourceCommit","staticCheckReceipt","studioLaunchReceipt",
    "privateExperienceId","playtestReceipt","revisionReceipt","finalPlayableReceipt"
  ].map(key => [key, key + "-proof"]));
  const result = certifyRobloxCaseStudy({
    evidence,
    privacy: { childRealNameExcluded: true, childAccountIdExcluded: true, publicAccessDisabled: true }
  });
  assert.equal(result.state, "CERTIFIED");
  assert.match(result.caseStudyId, /^ROBLOX-[A-F0-9]{16}$/);
});

test("Mac probe is read-only and rejects public publishing", () => {
  const probe = buildRobloxToolchainProbe({ root: "/Users/mac/Georgie-Roblox", allowedRoot: "/Users/mac/Georgie-Roblox" });
  assert.equal(probe.mutationPerformed, false);
  assert.throws(() => buildRobloxToolchainProbe({ root: "/Users/mac/Georgie-Roblox", allowedRoot: "/Users/mac/Georgie-Roblox", publicPublish: true }), /PROHIBITED/);
});
