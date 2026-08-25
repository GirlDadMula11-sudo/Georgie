import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const target = path.join(root, "src", "governed-connector.js");
let source = fs.readFileSync(target, "utf8");

const importLine = 'import { orchestrateCapabilityRequest } from "./capability-orchestrator.js";';
if (!source.includes(importLine)) {
  const anchor = 'import { crawlWebsite, pageSpeed, getApplicationFunnel, seoIntegrationStatus, websiteControlStatus } from "./integrations/seo-ops.js";';
  if (!source.includes(anchor)) throw new Error("CAPABILITY_ORCHESTRATOR_IMPORT_ANCHOR_NOT_FOUND");
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

for (const [before, after] of [
  ['  const capability = clean(input.capability || metadata.capability || metadata.requiredCapability || nested.capability, 160).toLowerCase();', '  let capability = clean(input.capability || metadata.capability || metadata.requiredCapability || nested.capability, 160).toLowerCase();'],
  ['  const targetDevice = clean(input.target_device || input.targetDevice || metadata.target_device || metadata.targetDevice || metadata.deviceId || nested.target_device || nested.targetDevice, 160);', '  let targetDevice = clean(input.target_device || input.targetDevice || metadata.target_device || metadata.targetDevice || metadata.deviceId || nested.target_device || nested.targetDevice, 160);'],
  ['  const operation = clean(input.operation || metadata.operation || nested.operation, 160).toLowerCase();', '  let operation = clean(input.operation || metadata.operation || nested.operation, 160).toLowerCase();'],
  ['  const authority = clean(input.authority || metadata.authority || metadata.mode || nested.authority, 80).toLowerCase();', '  let authority = clean(input.authority || metadata.authority || metadata.mode || nested.authority, 80).toLowerCase();'],
  ['  const prohibitedRoutes = [...new Set((input.prohibited_routes || metadata.prohibited_routes || metadata.prohibitedRoutes || nested.prohibited_routes || nested.prohibitedRoutes || []).map((value) => clean(value, 160).toLowerCase()).filter(Boolean))];', '  let prohibitedRoutes = [...new Set((input.prohibited_routes || metadata.prohibited_routes || metadata.prohibitedRoutes || nested.prohibited_routes || nested.prohibitedRoutes || []).map((value) => clean(value, 160).toLowerCase()).filter(Boolean))];']
]) {
  if (source.includes(before)) source = source.replace(before, after);
  else if (!source.includes(after)) throw new Error(`CAPABILITY_ORCHESTRATOR_MUTABLE_ANCHOR_NOT_FOUND: ${before.slice(0, 50)}`);
}

const typedAnchor = '  const typed = Boolean(capability || targetDevice || operation || authority || prohibitedRoutes.length);';
const orchestrationBlock = `  const typed = Boolean(capability || targetDevice || operation || authority || prohibitedRoutes.length);\n  let capabilityOrchestration = null;\n  if (typed) {\n    const orchestration = orchestrateCapabilityRequest({ capability, targetDevice, operation, authority, prohibitedRoutes, command }, CAPABILITIES);\n    capabilityOrchestration = orchestration.audit || { status: orchestration.status };\n    if (orchestration.status === "reformulated") {\n      capability = orchestration.route.capability;\n      targetDevice = orchestration.route.targetDevice;\n      operation = orchestration.route.operation;\n      authority = orchestration.route.authority;\n      prohibitedRoutes = orchestration.route.prohibitedRoutes || prohibitedRoutes;\n    } else if (orchestration.status === "unsupported" && orchestration.alternatives?.length) {\n      capabilityOrchestration = { ...capabilityOrchestration, alternatives: orchestration.alternatives };\n    }\n  }`;
if (!source.includes("let capabilityOrchestration = null;")) {
  if (!source.includes(typedAnchor)) throw new Error("CAPABILITY_ORCHESTRATOR_TYPED_ANCHOR_NOT_FOUND");
  source = source.replace(typedAnchor, orchestrationBlock);
}

const returnAnchor = '  return { source, idempotencyKey, command, kind, objectiveId: objectiveIdValue, planId: clean(input.planId, 160) || null, approvalId: clean(input.approvalId, 160) || null, metadata, routing: typed ? { objective_id: objectiveIdValue, capability, target_device: targetDevice, operation, authority, idempotency_key: idempotencyKey, prohibited_routes: prohibitedRoutes } : null };';
const returnReplacement = '  return { source, idempotencyKey, command, kind, objectiveId: objectiveIdValue, planId: clean(input.planId, 160) || null, approvalId: clean(input.approvalId, 160) || null, metadata: capabilityOrchestration ? { ...metadata, capability_orchestration: capabilityOrchestration } : metadata, routing: typed ? { objective_id: objectiveIdValue, capability, target_device: targetDevice, operation, authority, idempotency_key: idempotencyKey, prohibited_routes: prohibitedRoutes } : null };';
if (source.includes(returnAnchor)) source = source.replace(returnAnchor, returnReplacement);
else if (!source.includes(returnReplacement)) throw new Error("CAPABILITY_ORCHESTRATOR_RETURN_ANCHOR_NOT_FOUND");

fs.writeFileSync(target, source);
const verification = fs.readFileSync(target, "utf8");
for (const marker of ["orchestrateCapabilityRequest", "capabilityOrchestration", "capability_orchestration"]) {
  if (!verification.includes(marker)) throw new Error(`CAPABILITY_ORCHESTRATOR_VERIFICATION_FAILED: ${marker}`);
}

await import("./install-connector-offline-access.mjs");
await import("./install-v24-certification-repairs.mjs");
console.log("[Georgie] capability orchestration installed");
