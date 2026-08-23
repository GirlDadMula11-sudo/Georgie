import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { evaluationScorecard } from "./evaluation.js";
import { runStaticBenchmark } from "./intelligence-benchmark.js";

const NS = "self_evolution_v1";
const USER = () => process.env.GEORGIE_EXECUTIVE_USER_ID || process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const INTERVAL = Math.max(60 * 60_000, Number(process.env.GEORGIE_EVOLUTION_INTERVAL_MS || 6 * 60 * 60_000));
let timer = null;
let running = false;
const now = () => new Date().toISOString();

function proposal(area, priority, evidence, experiment) {
  return { id: crypto.createHash("sha256").update(`${area}:${experiment}`).digest("hex").slice(0, 16), area, priority, evidence, experiment, status: "proposed", authority: "evaluation_only", productionChanged: false };
}

export function buildEvolutionProposals(scorecard = {}, benchmark = {}) {
  const items = [];
  if (Number(scorecard.completionRate ?? 1) < 0.99) items.push(proposal("completion_reliability", 100, { completionRate: scorecard.completionRate }, "Replay incomplete traces and add a regression case for each reproducible failure."));
  if (Number(scorecard.actionSuccessRate ?? 1) < 0.95) items.push(proposal("tool_execution", 95, { actionSuccessRate: scorecard.actionSuccessRate }, "Grade failed tool traces, isolate the earliest failed precondition, and test a bounded recovery path."));
  if (Number(scorecard.highImpactReviewRequired || 0) > 0) items.push(proposal("evidence_grounding", 95, { highImpactReviewRequired: scorecard.highImpactReviewRequired }, "Require current authoritative evidence for the affected high-impact route and rerun held-out cases."));
  if (Number(scorecard.outcomeFeedback?.usefulnessRate ?? 1) < 0.85) items.push(proposal("answer_quality", 85, { usefulnessRate: scorecard.outcomeFeedback?.usefulnessRate }, "Cluster negative feedback by domain, create representative held-out prompts, and compare the proposed behavior against baseline."));
  if (Number(scorecard.latency?.firstResponseP95Ms || 0) > 3000) items.push(proposal("latency", 75, { firstResponseP95Ms: scorecard.latency.firstResponseP95Ms }, "Measure context, tool, and model latency separately; canary the smallest verified bottleneck reduction."));
  for (const failed of benchmark.failed || []) items.push(proposal(`benchmark:${failed}`, 80, { failedScenario: failed }, `Repair routing for ${failed} and require the deterministic benchmark plus regression tests to pass.`));
  if (!items.length) items.push(proposal("capability_expansion", 40, { benchmarkPassed: benchmark.passed, measuredTurns: scorecard.sampleSize || 0 }, "Research one high-value capability gap, document primary sources and historical context, then create an evaluation before any implementation."));
  return items.sort((a, b) => b.priority - a.priority);
}

function defaultState() {
  return { version: "self-evolution.v1", active: true, mode: "governed_continuous_improvement",
    learningPolicy: { currentClaimsRequireFreshSources: true, historicalClaimsRequireProvenance: true, separateFactInferenceForecast: true, contradictoryEvidenceQuarantined: true, verifiedOutcomesLearnedExactlyOnce: true, userCorrectionsOutrankInferredPreferences: true },
    promotionPolicy: { baselineBeforeChange: true, heldOutEvaluationRequired: true, regressionRequired: true, canaryAndRollbackRequired: true, automaticCodeMutation: "isolated_branch_only_when_shared_authority_policy_passes", automaticMainMerge: false, automaticCredentialChange: false, automaticProductionDeploy: false, consequentialActionsApprovalGated: true },
    researchModes: ["current_web_research", "deep_multi_source_research", "historical_context", "primary_source_review", "internal_verified_outcome_learning"], cycles: [], proposals: [], lastCycleAt: null };
}

export async function selfEvolutionStatus(userId = USER()) {
  const state = await readCloudState(String(userId || USER()), NS, defaultState());
  return { ...defaultState(), ...state, safety: "Georgie may research, evaluate, and propose improvements automatically. He may not rewrite, push, deploy, change credentials, or perform consequential business actions without the governed authority for that exact action." };
}

export async function runSelfEvolutionCycle(userId = USER()) {
  if (running) return { status: "already_running" };
  running = true;
  try {
    const uid = String(userId || USER());
    const [prior, scorecard] = await Promise.all([selfEvolutionStatus(uid), evaluationScorecard(uid, { limit: 500 })]);
    const benchmark = runStaticBenchmark();
    const proposals = buildEvolutionProposals(scorecard, benchmark);
    const cycle = { id: crypto.randomUUID(), observedAt: now(), status: "evaluated", inputs: { measuredTurns: scorecard.sampleSize, feedbackSamples: scorecard.outcomeFeedback?.sampleSize || 0, benchmarkVersion: benchmark.version, benchmarkPassed: benchmark.passed, benchmarkTotal: benchmark.total }, proposals: proposals.map(({ id, area, priority }) => ({ id, area, priority })), productionChanged: false };
    const merged = new Map((prior.proposals || []).map((item) => [item.id, item]));
    for (const item of proposals) merged.set(item.id, { ...merged.get(item.id), ...item, lastObservedAt: cycle.observedAt });
    const next = { ...prior, active: true, lastCycleAt: cycle.observedAt, cycles: [...(prior.cycles || []), cycle].slice(-100), proposals: [...merged.values()].sort((a, b) => b.priority - a.priority).slice(0, 100) };
    await writeCloudState(uid, NS, next);
    return { status: "completed", cycle, proposals, productionChanged: false, nextGate: "A proposed capability must beat baseline evaluations and pass regression, canary, verification, and rollback requirements before promotion." };
  } finally { running = false; }
}

export function startSelfEvolution() {
  if (timer || process.env.NODE_ENV === "test" || process.env.GEORGIE_SELF_EVOLUTION_ENABLED === "false") return timer;
  const execute = () => runSelfEvolutionCycle().catch((error) => console.warn("Self-evolution cycle delayed:", error instanceof Error ? error.message : error));
  timer = setInterval(execute, INTERVAL); timer.unref?.(); setTimeout(execute, 20_000).unref?.(); return timer;
}
