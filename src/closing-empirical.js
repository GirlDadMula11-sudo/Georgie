const CONTRACT = "georgie.master-closer-empirical.v1";
const TERMINAL_FAILURE = /declin|lost|withdraw|cancel|expired|rejected/i;
const FUNDED = /funded/i;
const TACTICS = [
  ["document_friction_reduction", /document|statement|stip|paperwork|upload|send (?:me|us)|need (?:the|your)/i],
  ["clarification_and_transparency", /explain|clarif|breakdown|total payback|payment|term|factor|rate|cost/i],
  ["follow_up_persistence", /follow(?:ing)? up|checking in|circling back|touching base|any update|status/i],
  ["comparison_or_batna", /other offer|alternative|compare|better terms|different option|another lender/i],
  ["conditional_concession", /if .* then|if you can|provided that|in exchange|subject to/i],
  ["specific_next_step", /please (?:send|confirm|reply|call|sign)|next step|by (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday)/i],
  ["relationship_trust", /happy to help|here to help|transparent|no pressure|work with you|available to discuss/i]
];

const clean = (v, max = 5000) => String(v ?? "").trim().slice(0, max);
const lower = v => clean(v).toLowerCase();

function outcomeOf(row = {}) {
  const dealStatus = lower(row.deal_status);
  const placementStatus = lower(row.placement_status);
  const funded = Boolean(row.deal_funded_at || row.placement_funded_at || FUNDED.test(dealStatus) || FUNDED.test(placementStatus));
  if (funded) return "funded";
  if (TERMINAL_FAILURE.test(`${dealStatus} ${placementStatus}`)) return "lost";
  return "non_terminal";
}

export function inferClosingTactics(row = {}) {
  const text = clean(`${row.subject || ""}\n${row.body_text || ""}`, 12000);
  return TACTICS.filter(([, rx]) => rx.test(text)).map(([name]) => name);
}

function metric(rows = [], keyFn = () => "unknown") {
  const groups = new Map();
  for (const row of rows) {
    const key = clean(keyFn(row), 200) || "unknown";
    const current = groups.get(key) || { key, samples: 0, funded: 0, lost: 0, nonTerminal: 0, fundedRevenue: 0 };
    current.samples += 1;
    const outcome = outcomeOf(row);
    if (outcome === "funded") {
      current.funded += 1;
      current.fundedRevenue += Math.max(0, Number(row.sierra_net_revenue) || 0);
    } else if (outcome === "lost") current.lost += 1;
    else current.nonTerminal += 1;
    groups.set(key, current);
  }
  return [...groups.values()].map(row => {
    const terminal = row.funded + row.lost;
    return {
      ...row,
      terminalSamples: terminal,
      fundedRateOnTerminal: terminal ? Number((row.funded / terminal).toFixed(4)) : null,
      avgRevenuePerFunded: row.funded ? Number((row.fundedRevenue / row.funded).toFixed(2)) : null
    };
  }).sort((a, b) => (b.terminalSamples - a.terminalSamples) || ((b.fundedRateOnTerminal || 0) - (a.fundedRateOnTerminal || 0)));
}

export function buildClosingEmpiricalScorecard(rows = [], { minGlobalSamples = 5, minLenderSamples = 10, minPromotionTerminalSamples = 8 } = {}) {
  const evidence = Array.isArray(rows) ? rows.filter(row => row && typeof row === "object") : [];
  const terminalRows = evidence.filter(row => outcomeOf(row) !== "non_terminal");
  const enriched = evidence.flatMap(row => inferClosingTactics(row).map(tactic => ({ ...row, tactic })));
  const tacticStats = metric(enriched, row => row.tactic);
  const lenderStats = metric(evidence, row => row.lender_name || row.funding_lender || "unknown");
  const classificationStats = metric(evidence, row => row.classification || "unknown");

  const promotions = tacticStats.map(stat => ({
    tactic: stat.key,
    terminalSamples: stat.terminalSamples,
    fundedRateOnTerminal: stat.fundedRateOnTerminal,
    eligibleForShadowPreference: stat.terminalSamples >= minGlobalSamples,
    eligibleForPrecertifiedAutonomy: stat.terminalSamples >= minPromotionTerminalSamples && stat.fundedRateOnTerminal !== null && stat.fundedRateOnTerminal >= 0.6
  }));

  return {
    contract: CONTRACT,
    observedAt: new Date().toISOString(),
    evidenceRows: evidence.length,
    terminalEvidenceRows: terminalRows.length,
    fundedEvidenceRows: terminalRows.filter(row => outcomeOf(row) === "funded").length,
    lostEvidenceRows: terminalRows.filter(row => outcomeOf(row) === "lost").length,
    tacticStats,
    lenderStats: lenderStats.map(stat => ({ ...stat, lenderSpecificLearningEligible: stat.terminalSamples >= minLenderSamples })),
    classificationStats,
    promotions,
    policy: {
      verifiedOutcomesOnly: true,
      syntheticTrainingAllowed: false,
      minGlobalSamples,
      minLenderSamples,
      minPromotionTerminalSamples,
      lenderSpecificAutonomyRequiresMinimumSample: true,
      promotionRequiresHeldOutValidation: true,
      fundedCloseRatePromise: false
    },
    readiness: {
      empiricalLearningActive: evidence.length > 0,
      enoughForGlobalShadowScoring: terminalRows.length >= minGlobalSamples,
      enoughForLenderSpecificPromotion: lenderStats.some(stat => stat.terminalSamples >= minLenderSamples),
      note: "Historical evidence can rank shadow tactics now; no lender-specific autonomy is promoted without the required verified sample and held-out validation."
    }
  };
}

export const closingEmpiricalContract = CONTRACT;
