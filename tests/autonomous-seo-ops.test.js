import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seoIntegrationStatus, websiteControlStatus, sameWebsiteHost } from "../src/integrations/seo-ops.js";
import { objectiveLane, objectiveWorkerStatus } from "../src/objective-worker.js";
import { componentsForProfile } from "../src/runtime-components.js";

test("production start uses unified durable runtime", () => {
  const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  assert.match(pkg.scripts.start,/node src\/runtime\.js$/);
  const componentIds=new Set(componentsForProfile("web", undefined, null, "full").map(component=>component.id));
  for(const id of ["objective-worker","engineering-coordinator","reconciliation","background-operating-layer"]) assert.ok(componentIds.has(id));
});

test("durable objective worker advertises restart recovery and approval awareness", () => {
  const status=objectiveWorkerStatus();
  assert.equal(status.durableStorage,true);
  assert.equal(status.restartRecovery,true);
  assert.equal(status.approvalAware,true);
  assert.equal(status.evidenceCheckpointing,true);
  assert.equal(status.independentLaneWorkers,true);
  assert.equal(status.leaseHeartbeats,true);
  assert.equal(status.durableCompletionReceipts,true);
  assert.deepEqual(status.lanes,["general","engineering","seo","closing"]);
});

test("business-critical work is routed into isolated execution lanes", () => {
  assert.equal(objectiveLane("wordpress-seo"),"seo");
  assert.equal(objectiveLane("verified-offer-closing-outreach"),"closing");
  assert.equal(objectiveLane("sierra-crm-repair"),"engineering");
  assert.equal(objectiveLane("personal"),"general");
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

test("production verifies materialized SEO tools while maintenance retains installer", () => {
  const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  assert.match(pkg.scripts.prestart,/verify-runtime-baseline\.mjs/);
  assert.match(pkg.scripts.check,/install-autonomous-seo-ops\.mjs/);
});

test("SEO host guard treats Sierra www and apex as the same controlled site", () => {
  assert.equal(sameWebsiteHost("https://www.sierramarketinginc.com/path", "https://sierramarketinginc.com/"), true);
  assert.equal(sameWebsiteHost("https://sierramarketinginc.com/path", "https://www.sierramarketinginc.com/"), true);
  assert.equal(sameWebsiteHost("https://evil.example/path", "https://www.sierramarketinginc.com/"), false);
});
