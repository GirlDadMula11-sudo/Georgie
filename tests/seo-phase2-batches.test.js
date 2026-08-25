import test from "node:test";
import assert from "node:assert/strict";
import { compileSeoPhase2Batch, compilePreservedSeoPhase2Command, SEO_PHASE2_BATCH_IDS, SEO_PHASE2_COMMAND_SEQUENCE, SEO_PHASE2_PROTECTED_SURFACES } from "../src/seo-phase2-batches.js";

test("exactly six Phase 2 batches are allowlisted", () => {
  assert.deepEqual(SEO_PHASE2_BATCH_IDS, [
    "homepage_positioning_and_onpage_integrity",
    "sitewide_positioning_and_topic_architecture",
    "money_page_fact_integrity",
    "trust_conversion_semantics",
    "qualified_conversion_architecture",
    "high_intent_authority_moat"
  ]);
  assert.equal(SEO_PHASE2_COMMAND_SEQUENCE.length, 6);
});

test("unknown and free-form SEO writes fail closed", () => {
  assert.throws(() => compileSeoPhase2Batch({ batch: "arbitrary_wordpress_write" }), /SEO_PHASE2_UNKNOWN_BATCH/);
  assert.throws(() => compileSeoPhase2Batch({ batch: "homepage_positioning_and_onpage_integrity", allowFreeform: true }), /SEO_PHASE2_FREEFORM_WRITE_REJECTED/);
});

test("homepage batch is narrow and requires semantic verification plus rollback", () => {
  const plan = compileSeoPhase2Batch({ batch: "homepage_positioning_and_onpage_integrity" });
  assert.deepEqual(plan.pages, ["/"]);
  assert.equal(plan.requiresBeforeState, true);
  assert.equal(plan.requiresRollbackMaterial, true);
  assert.equal(plan.requiresSemanticVerification, true);
  assert.equal(plan.duplicateReplayMustBeNoop, true);
  assert.ok(plan.changeClasses.includes("primary_h1"));
  assert.ok(plan.verification.includes("public_html"));
});

test("batch contracts cannot silently escape their page scope", () => {
  assert.throws(() => compileSeoPhase2Batch({ batch: "homepage_positioning_and_onpage_integrity", pages: ["/wp-admin/"] }), /SEO_PHASE2_PAGE_SCOPE_REJECTED/);
  assert.throws(() => compileSeoPhase2Batch({ batch: "homepage_positioning_and_onpage_integrity", pages: ["https://example.com/"] }), /SEO_PHASE2_EXTERNAL_URL_REJECTED/);
});

test("protected systems remain universal invariants", () => {
  for (const surface of ["form_post_endpoints", "users", "plugins", "security", "dns", "email", "lender_systems"]) {
    assert.ok(SEO_PHASE2_PROTECTED_SURFACES.includes(surface));
  }
});

test("qualified conversion may change visible CTA routing but not form backends", () => {
  const plan = compileSeoPhase2Batch({ batch: "qualified_conversion_architecture" });
  assert.ok(plan.changeClasses.includes("cta_href"));
  assert.ok(plan.protectedSurfaces.includes("form_post_endpoints"));
  assert.ok(plan.verification.includes("protected_form_backend_invariants"));
});

test("authority moat cannot create net-new pages under this repair", () => {
  const plan = compileSeoPhase2Batch({ batch: "high_intent_authority_moat" });
  assert.equal(plan.netNewPageCreation, false);
  assert.throws(() => compileSeoPhase2Batch({ batch: "high_intent_authority_moat", createPages: true }), /SEO_PHASE2_NET_NEW_PAGE_REJECTED/);
});

test("preserved command identities bind to exactly one batch and cannot be relabeled", () => {
  for (const item of SEO_PHASE2_COMMAND_SEQUENCE) {
    const plan = compilePreservedSeoPhase2Command({ commandId: item.commandId });
    assert.equal(plan.commandId, item.commandId);
    assert.equal(plan.batch, item.batch);
  }
  assert.throws(() => compilePreservedSeoPhase2Command({ commandId: "cmd_unknown" }), /SEO_PHASE2_UNKNOWN_COMMAND/);
  assert.throws(() => compilePreservedSeoPhase2Command({ commandId: SEO_PHASE2_COMMAND_SEQUENCE[0].commandId, batch: "money_page_fact_integrity" }), /SEO_PHASE2_COMMAND_BATCH_MISMATCH/);
});

test("six-barrier dependency order is explicit and stable", () => {
  SEO_PHASE2_COMMAND_SEQUENCE.forEach((item, index) => {
    const plan = compilePreservedSeoPhase2Command({ commandId: item.commandId });
    assert.equal(plan.sequenceIndex, index);
    assert.equal(plan.predecessorCommandId, index === 0 ? null : SEO_PHASE2_COMMAND_SEQUENCE[index - 1].commandId);
  });
});
