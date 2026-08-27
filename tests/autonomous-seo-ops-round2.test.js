import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seoContentPipelineContract } from "../src/seo-content-pipeline.js";
import { deploymentControlStatus } from "../src/integrations/deployment-control.js";
import { componentsForProfile } from "../src/runtime-components.js";

test("unified runtime starts recurring SEO scheduler",()=>{assert.ok(componentsForProfile("web").some(component=>component.id==="seo-monitor"));});
test("SEO content contract has full governed production flow",()=>{const c=seoContentPipelineContract();assert.equal(c.productionPublishApprovalRequired,true);for(const s of ["research","factual_verification","brief","draft","claims_compliance","internal_linking_schema","staging_preview","qa","publish_ready","published"])assert.ok(c.stages.includes(s));});
test("deployment control never exposes env values and keeps production approval bound",()=>{const c=deploymentControlStatus();assert.equal(c.rawEnvValuesReturned,false);assert.equal(c.productionChangesApprovalRequired,true);assert.equal(c.vercel.rollback,true);assert.equal(c.vercel.productionPromotion,true);});
test("round2 installer registers monitor content pipeline and deployment tools",()=>{const src=fs.readFileSync(new URL("../scripts/install-autonomous-seo-ops-round2.mjs",import.meta.url),"utf8");for(const n of ["seo.monitor.configure","seo.monitor.status","seo.content_pipeline.create","seo.content_pipeline.checkpoint","deployment.vercel.promote","deployment.vercel.rollback","deployment.render.redeploy"])assert.match(src,new RegExp(n.replaceAll(".","\\.")));});
test("production scripts install both autonomous SEO layers",()=>{const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));for(const s of [pkg.scripts.prestart,pkg.scripts.check]){assert.match(s,/install-autonomous-seo-ops\.mjs/);assert.match(s,/install-autonomous-seo-ops-round2\.mjs/);}});
