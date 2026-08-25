import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seoIntegrationStatus, websiteControlStatus } from "../src/integrations/seo-ops.js";
import { objectiveWorkerStatus } from "../src/objective-worker.js";

test("production start uses unified durable runtime", () => {
  const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  assert.match(pkg.scripts.start,/node src\/runtime\.js$/);
  const runtime=fs.readFileSync(new URL("../src/runtime.js",import.meta.url),"utf8");
  assert.match(runtime,/startObjectiveWorker\(\)/);
  assert.match(runtime,/startEngineeringCoordinator\(\)/);
  assert.match(runtime,/startReconciliationWorkers\(\)/);
  assert.match(runtime,/startBackgroundOperatingLayer\(\)/);
});

test("durable objective worker advertises restart recovery and approval awareness", () => {
  const status=objectiveWorkerStatus();
  assert.equal(status.durableStorage,true);
  assert.equal(status.restartRecovery,true);
  assert.equal(status.approvalAware,true);
  assert.equal(status.evidenceCheckpointing,true);
});

test("SEO integration remains fail-closed when provider credentials are absent", () => {
  const status=seoIntegrationStatus();
  assert.equal(typeof status.googleSearchConsoleConfigured,"boolean");
  assert.equal(typeof status.ga4Configured,"boolean");
  assert.equal(status.durableEvidenceLedger,true);
  assert.equal(status.pageSpeedConfigured,true);
});

test("website control contract enumerates governed SEO-editing surfaces", () => {
  const status=websiteControlStatus();
  for(const required of ["titles","metadata","content","schema","internal_links","navigation","ctas","redirects","sitemaps"]) assert.ok(status.editableSurfaces.includes(required));
});

test("installer registers objective, analytics, crawler, indexing, synthetic and evidence tools", () => {
  const source=fs.readFileSync(new URL("../scripts/install-autonomous-seo-ops.mjs",import.meta.url),"utf8");
  for(const name of ["system.objective_schedule","system.objective_list","seo.search_console","seo.ga4","seo.crawl","seo.pagespeed","seo.sitemap_submit","seo.indexnow","seo.record_attribution","seo.application_funnel","seo.experiment_record","seo.funded_outcomes","seo.evidence_record","seo.synthetic_conversion"]) assert.match(source,new RegExp(name.replaceAll(".","\\.")));
});

test("SEO tool installer is present in both prestart and check", () => {
  const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  assert.match(pkg.scripts.prestart,/install-autonomous-seo-ops\.mjs/);
  assert.match(pkg.scripts.check,/install-autonomous-seo-ops\.mjs/);
});
