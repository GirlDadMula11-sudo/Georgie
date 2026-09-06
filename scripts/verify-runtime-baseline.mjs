import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateRuntimeRegistry } from "../src/runtime-components.js";

const root = process.cwd();
const requiredMarkers = new Map([
  ["src/objective-worker.js", ["recoveryDecision", "reliabilityReceipt", "attemptsByStep"]],
  ["src/tools.js", ["system.objective_schedule", "seo.monitor.configure", "deployment.render.redeploy"]],
  ["src/server.js", ["createGithubReceiptRelayRouter", "createGithubControlInboundRouter"]],
  ["src/smartlead-reply-closer-worker.js", ["SMARTLEAD_REPLY_CLOSER_AUTHORITY_START_ERROR"]],
  ["mac-agent/agent.js", ["browser.wordpress_enable_application_passwords"]],
  ["src/governed-connector.js", ["failedActions=Array.isArray(result?.actions)", "||failedActions"]],
  ["src/fast-intents.js", ["georgieRuntimeSelfInspection", 'scope: "runtime_authority"']],
  ["src/v2-turn-engine.js", ["deterministic-runtime-status", "Georgie runtime certification:", 'result?.tool==="system.status"', "unified-georgie-runtime-v1-local-inspection", "deterministic_local"]],
  ["src/memory.js", ["MEMORY_READ_TIMEOUT_MS", "durable_cloud_with_local_mirror", "foregroundReadBudgetMs", "durable local mirror retained"]],
  ["src/georgie.js", ["modelCreditBlock", "model_credits_exhausted", "credit-blocked-truthful-fallback", "Nothing is still running"]],
  ["src/reliability-fast-paths.js", ["sierraNativeConversationResponse", "deterministic-practical-guidance", "scheduled blocks", "ten-minute reset"]],
  ["src/sierra-native-intelligence.js", ["defaultAuthority:\"sierra_native\"", "externalModelRole:\"optional_accelerator_only\"", "providerFailureDoesNotTerminateGeorgie:true", "I’m here. What are we attacking?"]],
  ["src/intelligence-gateway.js", ["providerAuthority:\"sierra_native\"", "externalInferenceRole:\"optional_accelerator\"", "sierra_native"]],
  ["src/model-cost-governor.js", ["GEORGIE_MODEL_REQUESTS_PER_MINUTE", "GEORGIE_MODEL_REQUESTS_PER_DAY", "billingCircuitOpen", "blockedRequests"]],
  ["src/resource-governor.js", ["modelCostBudget", "modelCostGovernorStatus"]],
  ["src/capability-manifest.js", ["runtimeAuthority", "sourceMutationDuringStartup: false", "specialistFailureIsolation: true", "coreFirstStartup: true"]],
  ["src/runtime-components.js", ["SPECIALIST_COMPONENT_IDS", "Georgie specialist isolated", 'component.plane === "core"', "scheduleRuntimePlane", "SPECIALIST_START_DELAY_MS"]],
  ["src/runtime.js", ['plane: "core"', 'scheduleRuntimePlane("web", "specialist")']],
  ["src/resource-governor.js", ["specialistExecutionPermit", "core_reasoning_queued", "event_loop_pressure"]],
  ["src/seo-monitor.js", ['specialistExecutionPermit("seo-monitor")']],
  ["src/smartlead-reply-closer-worker.js", ['specialistExecutionPermit("smartlead-reply-closer")']],
  ["src/lender-delivery-worker.js", ['specialistExecutionPermit("lender-delivery")']],
  ["src/sierra-closing-outreach-worker.js", ['specialistExecutionPermit("sierra-closing-outreach")']],
]);
const syntaxFiles = [
  "src/runtime.js", "src/runtime-components.js", "src/server.js", "src/objective-worker.js",
  "src/tools.js", "src/smartlead-reply-closer-worker.js", "src/capability-orchestrator.js",
  "src/github-receipt-relay.js", "src/github-control-inbound.js", "src/governed-connector.js",
  "src/fast-intents.js", "src/capability-manifest.js", "src/resource-governor.js",
  "src/seo-monitor.js", "src/smartlead-reply-closer-worker.js", "src/lender-delivery-worker.js",
  "src/sierra-closing-outreach-worker.js", "src/sierra-native-intelligence.js", "src/intelligence-gateway.js",
  "src/reliability-fast-paths.js", "mac-agent/agent.js",
];

const registry = validateRuntimeRegistry();
if (!registry.ok) throw new Error(`RUNTIME_REGISTRY_INVALID:${registry.errors.join(",")}`);

for (const [file, markers] of requiredMarkers) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  for (const marker of markers) if (!source.includes(marker)) throw new Error(`RUNTIME_BASELINE_MARKER_MISSING:${file}:${marker}`);
}

const objectiveSource = fs.readFileSync(path.join(root, "src/objective-worker.js"), "utf8");
const initialization = "objective.attemptsByStep = objective.attemptsByStep || {}; objective.recoveryTrail = Array.isArray(objective.recoveryTrail) ? objective.recoveryTrail : [];";
if (objectiveSource.split(initialization).length - 1 !== 1) throw new Error("RUNTIME_BASELINE_DUPLICATE_RECOVERY_INITIALIZATION");

for (const file of syntaxFiles) execFileSync(process.execPath, ["--check", file], { cwd: root, stdio: "pipe" });
console.log(`Georgie runtime baseline verified (${registry.componentCount} components, kernel=${registry.kernel}, mutation=false)`);
