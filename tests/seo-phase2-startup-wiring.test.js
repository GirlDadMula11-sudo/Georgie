import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const macBuild = fs.readFileSync(new URL("../mac-agent/build-runtime.mjs", import.meta.url), "utf8");

test("production prestart verifies the materialized bounded SEO Phase 2 executor", () => {
  assert.match(pkg.scripts.prestart, /node scripts\/verify-runtime-baseline\.mjs/);
});

test("primary-mac runtime build installs and certifies the Phase 2 writer", () => {
  assert.match(macBuild, /import "\.\.\/scripts\/install-seo-phase2-executor\.mjs";/);
  assert.match(macBuild, /browser\.wordpress_phase2_batch/);
  assert.match(macBuild, /browser\.wordpress_phase2_rollback/);
  assert.match(macBuild, /seoPhase2Capability: true/);
});
