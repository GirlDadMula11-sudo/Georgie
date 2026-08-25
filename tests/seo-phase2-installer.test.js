import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Phase 2 installer materializes bounded runtime wiring while preserving legacy SEO compatibility", () => {
  const tools = fs.readFileSync("src/tools.js", "utf8");
  const connector = fs.readFileSync("src/governed-connector.js", "utf8");
  const mac = fs.readFileSync("mac-agent/agent.js", "utf8");

  for (const name of ["seo.phase2_before_state", "seo.phase2_batch_execute", "seo.phase2_batch_verify", "seo.phase2_after_state"]) {
    assert.match(tools, new RegExp(`name:\\"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\"`));
  }
  assert.match(connector, /SEO_PHASE2_TYPED_START/);
  assert.match(connector, /buildSeoPhase2Objective/);
  assert.match(connector, /SEO_PHASE2_COMMAND_SEQUENCE/);
  assert.match(mac, /browser\.wordpress_phase2_batch/);
  assert.match(mac, /browser\.wordpress_phase2_rollback/);
  assert.match(mac, /seo-phase2-executions\.json/);

  assert.match(tools, /seo\.wordpress_link_integrity_repair/);
  assert.match(connector, /repair-link-integrity/);
  assert.match(mac, /browser\.wordpress_link_integrity_repair/);
});
