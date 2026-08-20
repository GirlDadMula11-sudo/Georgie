import { deterministicToolPlan } from "./fast-intents.js";
import { intelligenceRoute } from "./intelligence-gateway.js";
import { runtimePolicy } from "./runtime-policy.js";

export const BENCHMARK_TARGETS = Object.freeze({ simpleAnswerMs: 2000, routineActionMs: 5000, complexFirstResponseMs: 3000 });
export const RELIABILITY_TARGETS = Object.freeze({ silentTurnRate: 0, permanentlyWorkingTurnRate: 0, unsupportedCompletionClaims: 0, approvalBypassRate: 0, patchIntegrityFailures: 0, minimumMeasuredTurnsForCertification: 200 });
export const BENCHMARK_SCENARIOS = Object.freeze([
  { id: "personal", prompt: "Help me prioritize my family obligations and explain the tradeoffs.", expectedDomain: "personal", expectedTier: "frontier" },
  { id: "research", prompt: "Research the latest changes in aviation training regulations.", expectedWeb: true, expectedTier: "frontier" },
  { id: "technical", prompt: "Diagnose the root cause of this API latency and compare two repair strategies.", expectedTier: "frontier" },
  { id: "creative", prompt: "Write three distinctive concepts for a sophisticated music video.", expectedTier: "balanced" },
  { id: "sierra", prompt: "Diagnose Sierra underwriting evidence contradictions before lender submission.", expectedDomain: "sierra", expectedTier: "frontier" },
  { id: "decision", prompt: "Evaluate this decision, challenge my assumptions, and show the strongest counterargument.", expectedTier: "frontier" },
  { id: "fast", prompt: "Hello Georgie", expectedTier: "fast" },
  { id: "world_state", prompt: "What are we working on and what remains unfinished?", expectedTool: "system.world_state" }
  ,{ id: "sierra_governed_access", prompt: "Run the Sierra governed-access probe and show which RPC contracts are live.", expectedDomain: "sierra", expectedTool: "sierra.governed_access" }
  ,{ id: "developer_inspect", prompt: "Inspect my Georgie repository and report the branch and uncommitted changes.", expectedDomain: "technical", expectedTool: "developer.repo_inspect" }
]);

export function runStaticBenchmark() {
  const cases = BENCHMARK_SCENARIOS.map((scenario) => {
    const route = intelligenceRoute(scenario.prompt), policy = runtimePolicy(scenario.prompt), tools = deterministicToolPlan(scenario.prompt);
    const checks = [scenario.expectedDomain ? route.domain === scenario.expectedDomain : true, scenario.expectedTier ? route.tier === scenario.expectedTier : true, scenario.expectedWeb !== undefined ? route.allowWebTool === scenario.expectedWeb : true, scenario.expectedTool ? tools.some((item) => item.tool === scenario.expectedTool) : true];
    return { id: scenario.id, passed: checks.every(Boolean), route, policy, tools };
  });
  return { version: "2026-08-20.2", targets: BENCHMARK_TARGETS, reliabilityTargets: RELIABILITY_TARGETS, certificationRule:"Static routing success is not evidence of comparative model superiority. Certification requires measured held-out outcomes and the minimum sample size.", total: cases.length, passed: cases.filter((item) => item.passed).length, failed: cases.filter((item) => !item.passed).map((item) => item.id), cases };
}
