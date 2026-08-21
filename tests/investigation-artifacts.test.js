import test from "node:test";
import assert from "node:assert/strict";
import { certifyInvestigationReadBack, createInvestigationArtifact, nextUndeliveredSection } from "../src/investigation-artifacts.js";
import { deterministicToolPlan } from "../src/fast-intents.js";

const plan={requestId:"ac04eff4-b93d-4388-91e2-fff401374ed6",version:2,scope:"sierra_end_to_end",completedAt:"2026-08-21T22:00:00.000Z",steps:[{stepId:"one",tool:"sierra.health",args:{},status:"completed",completedAt:"2026-08-21T21:59:00.000Z",evidenceOutput:{healthy:true}},{stepId:"two",tool:"sierra.infrastructure",args:{},status:"completed",completedAt:"2026-08-21T21:59:30.000Z",evidenceOutput:{queues:0}}],synthesis:{evidenceGaps:[],contradictions:[]}};

test("investigation artifact separates execution, persistence, generation, and delivery",()=>{const artifact=createInvestigationArtifact(plan);assert.equal(artifact.lifecycle.executionFinishedAt,plan.completedAt);assert.equal(artifact.lifecycle.evidencePersistedAt,null);assert.ok(artifact.lifecycle.reportGeneratedAt);assert.equal(artifact.lifecycle.reportDeliveredAt,null);assert.equal(nextUndeliveredSection(artifact).id,"executive-verdict");});
test("evidence coverage fails closed until every completed payload reads back",()=>{const artifact=createInvestigationArtifact(plan),partial=structuredClone(artifact);partial.contracts[1].output=null;certifyInvestigationReadBack(artifact,partial);assert.equal(artifact.evidenceCoverage.readBackPassed,false);assert.equal(artifact.evidenceCoverage.verified,1);assert.equal(artifact.status,"blocked_incomplete_evidence");});
test("open investigation intent routes by exact durable ID",()=>{const action=deterministicToolPlan("Open investigation ac04eff4-b93d-4388-91e2-fff401374ed6 and render the control brief")[0];assert.equal(action.tool,"sierra.investigation_open");assert.equal(action.args.investigationId,plan.requestId);});
