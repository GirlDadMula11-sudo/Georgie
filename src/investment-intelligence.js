import { dayTradingCapabilityContract } from "./day-trading-intelligence.js";

const INVESTMENT = /\b(stock(?:s)?|equity|equities|crypto(?:currency)?|bitcoin|btc|ethereum|eth|token|blockchain|etf|bond|treasury|fixed income|commodity|gold|oil|forex|currency|option(?:s)?|future(?:s)?|portfolio|brokerage|dividend|earnings|valuation|market cap|short interest|sec filing|10-[kq]|8-k|yield curve|investment|investing|trade|trading)\b/i;
export function isInvestmentIntent(input = "") { return INVESTMENT.test(String(input || "")); }
export function investmentDirectResponse(input = "", history = []) {
  if (!isInvestmentIntent(input) && !/\b(?:automate|autopilot|control it all|control everything|run it all|do it all)\b/i.test(String(input||""))) return null;
  const text = String(input || "").toLowerCase();
  const recent = Array.isArray(history) ? history.slice(-8).map(item=>String(item?.content||"")).join(" ").toLowerCase() : "";
  const combined = text + " " + recent;
  const asksDayTrading = /\bday\s*trad(?:e|ing)\b/.test(text);
  const asksToManage = /\b(?:can|could|would|will)\s+you\s+(?:manage|handle|invest|trade|build|run)\b/.test(text) || /\bmanage\s+my\s+(?:stocks?|portfolio|investments?)\b/.test(text);
  const asksAutonomy = /\b(?:automate|autopilot|control it all|control everything|run it all|do it all|take over)\b/.test(text) && /\b(?:you|through you|for me|trading|trade|stocks?|portfolio|invest)\b/.test(combined);
  if (!asksToManage && !asksDayTrading && !asksAutonomy) return null;
  const match = combined.match(/\$\s?(\d+(?:,\d{3})*(?:\.\d{1,2})?)/);
  const budget = match?.[1]?.replace(/,/g, "") || null;
  if (asksAutonomy) {
    return {
      text: "I can automate almost the entire trading workflow for you: screening, research, watchlists, risk rules, position sizing, entry/exit logic, alerts, paper trading, portfolio monitoring, trade journaling, and exact order preparation. What I will not do is place real-money trades or move funds completely on my own. The strongest setup is near-autopilot: I do the analysis and prepare the exact live order, then you approve or reject that specific trade. After approval, the system can execute only that approved order and verify the result. " + (budget ? "With your $" + budget + " account, I would keep risk especially tight and make the approval step fast and simple." : "For a small account, I would keep risk especially tight and make the approval step fast and simple."),
      responseId:null, webSearches:0, model:"deterministic-investment-authority", completed:true, terminalState:"verified",
      route:{domain:"investment",tier:"fast",reasoningEffort:"low",latencyClass:"instant"}
    };
  }
  if (asksDayTrading) {
    const accountText = budget ? "With a $" + budget + " account, " : "With a small account, ";
    return {
      text: "Day trading is something I can help you analyze and manage as a disciplined strategy, but " + accountText + "I would treat it as a tightly controlled experiment rather than the core plan. I can screen liquid setups, define entries, exits, stop levels, position size, maximum daily loss, and keep a trade journal, then tell you when the setup no longer has an edge. I will not place real trades on my own; each live order still needs your specific approval. The biggest risks at this size are overtrading, spreads/fees, concentration, and trying to force daily profits. If you want, I can build a $" + (budget || "200") + " day-trading ruleset and a separate longer-term allocation so the two do not contaminate each other.",
      responseId:null, webSearches:0, model:"deterministic-investment-capability", completed:true, terminalState:"verified",
      route:{domain:"investment",tier:"fast",reasoningEffort:"low",latencyClass:"instant"}
    };
  }
  const budgetText = budget ? "With $" + budget + ", I can build a disciplined starter plan around position sizing, diversification, downside limits, fees, and what each position is supposed to accomplish. " : "I can build and manage the research, allocation plan, risk rules, watchlist, and decision process. ";
  return {
    text: "Yes — I can manage the intelligence and decision process around your stocks at a very high level. " + budgetText + "I can research current opportunities, compare bull/base/bear cases, track the portfolio, tell you when the thesis changes, and prepare exact trades for your approval. I will not place real trades or move money on my own; each real transaction still needs your specific approval. For a small account, I’d focus on avoiding overtrading and concentration before chasing returns. If you want, give me your time horizon and how much of that money you could tolerate losing, and I’ll build the first allocation.",
    responseId:null, webSearches:0, model:"deterministic-investment-capability", completed:true, terminalState:"verified",
    route:{domain:"investment",tier:"fast",reasoningEffort:"low",latencyClass:"instant"}
  };
}

export function investmentRuntimePrompt(input = "") {
  if (!isInvestmentIntent(input)) return "";
  const dayTrading = /\b(day\s*trad(?:e|ing)|scalp(?:ing)?|intraday|opening range|vwap)\b/i.test(String(input||""));
  return `INVESTMENT INTELLIGENCE DESK
- Operate as a cross-asset research and risk intelligence system covering public equities, ETFs, mutual funds, fixed income, rates, commodities, currencies, listed derivatives, cryptoassets, stablecoins, protocols, and portfolio construction.
- Current market facts require current evidence. Never invent or silently reuse a price, quote, yield, market cap, filing fact, corporate action, token supply, protocol metric, news event, analyst estimate, or regulatory status. Attach source and as-of time; identify delayed data. If live evidence is unavailable, say exactly what is unavailable and continue with clearly labeled historical or conceptual analysis.
- Use an evidence hierarchy: primary filings and issuer/protocol disclosures; regulator and exchange records; audited financials and on-chain data with chain/block/time; reputable institutional market data; then secondary reporting. Preserve disagreement and data-vendor differences.
- Separate observed fact, calculation, inference, scenario, forecast, and opinion. State material assumptions. Calibrate confidence and identify what would falsify the thesis.
- For equities, analyze business quality, industry structure, management and capital allocation, financial statements, earnings quality, dilution, valuation, catalysts, downside cases, liquidity, ownership, filings, and macro sensitivity.
- For crypto, analyze asset purpose, token economics and unlocks, holder concentration, custody, chain and bridge risk, smart-contract/admin-key risk, liquidity and venue fragmentation, stablecoin/depeg exposure, governance, protocol revenue versus incentives, on-chain activity, exploits, regulatory uncertainty, and manipulation risk. Never treat token price as proof of protocol value.
- For portfolios, reason in positions and exposures rather than tickers alone: concentration, correlation, factor and sector exposure, duration, credit, currency, volatility, liquidity, leverage, drawdown, tax sensitivity, custody/counterparty risk, and scenario stress. Do not claim diversification from asset count alone.
${dayTrading?`- DAY-TRADING MODE: classify regime before setup selection; require timestamped bid/ask/last/volume; reject stale or illiquid evidence; measure spread and expected slippage; require explicit entry, stop, target, reward/risk and invalidation; size from risk budget rather than conviction; enforce daily-loss, open-risk, consecutive-loss cooldown and kill-switch gates; separate catalyst/event risk from technical setups; prefer no-trade over low-quality action; log every paper candidate and rejection; evaluate expectancy, profit factor, drawdown, MAE/MFE, slippage and performance by setup and regime; do not promote a strategy from anecdotes or a tiny sample.`:""}
- Recommendations must match the user's objective, time horizon, liquidity needs, jurisdiction, tax/account type, loss tolerance, constraints, and existing exposure. If those are unknown, provide conditional scenarios rather than pretending there is one correct allocation.
- Always present the strongest bull case, base case, bear case, key risks, invalidation conditions, and a decision-ready next step. Avoid hype, FOMO, guaranteed-return language, false precision, and personalized certainty.
- Research, watchlists, alerts, models, draft orders, and paper-trading simulations may be prepared. Any real order, transfer, wallet transaction, staking, lending, leverage, derivatives position, brokerage permission change, API trading activation, or irreversible financial action requires explicit transaction-specific approval plus independent verification of instrument, venue, side, order type, quantity/notional, limit/slippage, fees, account, and maximum loss. Never autonomously trade or custody assets.
- Disclose important limitations and conflicts. Do not present Georgie as a registered investment adviser, broker, exchange, custodian, tax professional, or fiduciary. Encourage qualified professional review when suitability, taxes, legal status, retirement assets, leverage, or material loss exposure warrants it.`;
}
export function investmentCapabilityContract() {
  return {
    schema: "georgie.investment-intelligence.v1",
    extensions:["georgie.day-trading.v2"],
    assetClasses: ["equities", "funds", "fixed_income", "rates", "commodities", "fx", "listed_derivatives", "cryptoassets", "stablecoins", "defi"],
    evidence: { currentFactsRequireAsOfTime: true, sourcesRequired: true, delayedDataLabeled: true, primarySourcesPreferred: true, conflictsPreserved: true },
    analysis: ["fundamental", "valuation", "technical_context", "macro", "on_chain", "tokenomics", "portfolio_exposure", "scenario_stress", "risk_budgeting", "intraday_regime", "execution_quality", "setup_expectancy"],
    dayTrading: dayTradingCapabilityContract(),
    permittedWithoutTransactionApproval: ["research", "education", "screening", "watchlists", "alerts", "scenario_models", "paper_trading", "draft_orders"],
    transactionApproval: { required: true, transactionSpecific: true, independentlyVerified: true, fields: ["instrument", "venue", "account", "side", "order_type", "quantity_or_notional", "price_or_limit", "fees_and_slippage", "maximum_loss"] },
    autonomousTrading: false,
    autonomousCustody: false
  };
}
