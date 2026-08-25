import test from "node:test";
import assert from "node:assert/strict";
import { SEO_PHASE2_COMMAND_SEQUENCE, compilePreservedSeoPhase2Command } from "../src/seo-phase2-batches.js";
import { phase2PlanFingerprint } from "../src/seo-phase2-executor.js";
import { localSeoPhase2PlanHash, validateSeoPhase2MacRequest } from "../mac-agent/seo-phase2-writer.js";
import { buildSeoPhase2WordpressPageScriptWithRollback } from "../mac-agent/seo-phase2-writer-v2.js";
import { verifySeoPhase2PublicState } from "../src/seo-phase2-public.js";

function macArgs(commandId) {
  const plan = compilePreservedSeoPhase2Command({ commandId });
  return {
    siteOrigin: "https://sierramarketinginc.com",
    authority: "reversible_write",
    operation: "execute_phase2_batch",
    commandId,
    batch: plan.batch,
    planHash: phase2PlanFingerprint(plan),
    pages: plan.pages,
    changeClasses: plan.changeClasses,
    protectedSurfaces: plan.protectedSurfaces
  };
}

test("server and Mac independently derive the same immutable plan fingerprint for all six barriers", () => {
  for (const item of SEO_PHASE2_COMMAND_SEQUENCE) {
    const plan = compilePreservedSeoPhase2Command({ commandId: item.commandId });
    assert.equal(localSeoPhase2PlanHash(item.commandId), phase2PlanFingerprint(plan));
    assert.equal(validateSeoPhase2MacRequest(macArgs(item.commandId)).commandId, item.commandId);
  }
});

test("Mac writer rejects relabeling, scope expansion and altered plan hashes", () => {
  const commandId = SEO_PHASE2_COMMAND_SEQUENCE[0].commandId;
  const valid = macArgs(commandId);
  assert.throws(() => validateSeoPhase2MacRequest({ ...valid, batch: "money_page_fact_integrity" }), /BATCH_MISMATCH/);
  assert.throws(() => validateSeoPhase2MacRequest({ ...valid, pages: ["/", "/wp-admin/"] }), /PAGE_SCOPE_MISMATCH/);
  assert.throws(() => validateSeoPhase2MacRequest({ ...valid, planHash: "0".repeat(64) }), /PLAN_HASH_MISMATCH/);
});

test("generated WordPress writer contains rollback material and exact preserved identity", () => {
  const commandId = SEO_PHASE2_COMMAND_SEQUENCE[0].commandId;
  const script = buildSeoPhase2WordpressPageScriptWithRollback(macArgs(commandId));
  assert.match(script, new RegExp(commandId));
  assert.match(script, /rollbackBundle: originals/);
  assert.match(script, /Fast Small Business Loans in USA/);
  assert.match(script, /Strategic Business Financing Advisory/);
  assert.doesNotMatch(script, /wp-admin\/plugins|users\/|dns|email\.send/i);
});

test("public semantic verifier fails speed-first homepage and passes repaired advisory homepage", async () => {
  const badHtml = `<!doctype html><html><head><title>Fast Small Business Loans in USA</title></head><body><h1>Fast Small Business Loans in USA</h1><p>Your growth should never wait for slow lenders.</p></body></html>`;
  const goodHtml = `<!doctype html><html><head><title>Strategic Business Financing Advisory | Sierra Marketing Inc</title></head><body><h1>Strategic Business Financing Advisory for Established Businesses</h1><p>Build your financing strategy around fit, readiness, and long-term cash flow.</p></body></html>`;
  const mock = html => async () => ({ status: 200, text: async () => html });
  const bad = await verifySeoPhase2PublicState({ batch: "homepage_positioning_and_onpage_integrity", pages: ["/"], planHash: "x", fetchImpl: mock(badHtml) });
  assert.equal(bad.verified, false);
  const good = await verifySeoPhase2PublicState({ batch: "homepage_positioning_and_onpage_integrity", pages: ["/"], planHash: "x", fetchImpl: mock(goodHtml) });
  assert.equal(good.verified, true);
});
