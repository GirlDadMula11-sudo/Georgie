const BASE = "https://data.alpaca.markets";
const DEFAULT_FEED = "iex";
const DEFAULT_MAX_AGE_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 5_000;

function credentials() {
  return {
    key: process.env.ALPACA_API_KEY_ID || process.env.APCA_API_KEY_ID || process.env.GEORGIE_MARKET_DATA_API_KEY || "",
    secret: process.env.ALPACA_API_SECRET_KEY || process.env.APCA_API_SECRET_KEY || process.env.GEORGIE_MARKET_DATA_API_SECRET || ""
  };
}

export function alpacaConfigured() {
  const { key, secret } = credentials();
  return Boolean(key && secret);
}

function authHeaders() {
  const { key, secret } = credentials();
  if (!key || !secret) throw new Error("Alpaca market data credentials are not configured");
  return { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, Accept: "application/json" };
}

function parseTimestamp(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function ageMs(value, nowMs) {
  const ms = parseTimestamp(value);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, nowMs - ms);
}

async function get(path, params = {}, options = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const fetchImpl = options.fetchImpl || fetch;
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.GEORGIE_MARKET_DATA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: authHeaders(), signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: String(text || "").slice(0, 300) }; }
    if (!response.ok) {
      const err = new Error(`Alpaca market data HTTP ${response.status}: ${body?.message || response.statusText || "request failed"}`);
      err.status = response.status;
      throw err;
    }
    return { body, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

export function assessMarketSnapshot(snapshot, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || process.env.GEORGIE_MARKET_DATA_MAX_AGE_MS || DEFAULT_MAX_AGE_MS));
  const bid = Number(snapshot?.quote?.bid);
  const ask = Number(snapshot?.quote?.ask);
  const last = Number(snapshot?.trade?.last);
  const volume = Number(snapshot?.bar?.volume);
  const quoteAgeMs = ageMs(snapshot?.quote?.timestamp, nowMs);
  const tradeAgeMs = ageMs(snapshot?.trade?.timestamp, nowMs);
  const barAgeMs = ageMs(snapshot?.bar?.timestamp, nowMs);
  const schemaValid = [bid, ask, last, volume].every(Number.isFinite) && bid > 0 && ask >= bid && last > 0 && volume >= 0;
  const timestampsValid = [quoteAgeMs, tradeAgeMs, barAgeMs].every(Number.isFinite);
  const fresh = timestampsValid && quoteAgeMs <= maxAgeMs && tradeAgeMs <= maxAgeMs && barAgeMs <= Math.max(maxAgeMs, 60_000);
  const midpoint = schemaValid ? (bid + ask) / 2 : null;
  const spreadBps = schemaValid && midpoint > 0 ? ((ask - bid) / midpoint) * 10_000 : null;
  const coherent = schemaValid && last >= bid * 0.95 && last <= ask * 1.05;
  const failures = [];
  if (!schemaValid) failures.push("invalid_schema");
  if (!timestampsValid) failures.push("missing_timestamp");
  if (timestampsValid && !fresh) failures.push("stale_market_data");
  if (schemaValid && !coherent) failures.push("incoherent_quote_trade");
  return { schemaValid, timestampsValid, fresh, coherent, spreadBps, quoteAgeMs, tradeAgeMs, barAgeMs, maxAgeMs, failures, certified: failures.length === 0 };
}

export async function latestStockSnapshot(symbol, options = {}) {
  const ticker = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) throw new Error("invalid stock symbol");
  const feed = String(options.feed || process.env.GEORGIE_ALPACA_FEED || DEFAULT_FEED).toLowerCase();
  const requestOptions = { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs };
  const [q, t, b] = await Promise.all([
    get(`/v2/stocks/${encodeURIComponent(ticker)}/quotes/latest`, { feed }, requestOptions),
    get(`/v2/stocks/${encodeURIComponent(ticker)}/trades/latest`, { feed }, requestOptions),
    get(`/v2/stocks/${encodeURIComponent(ticker)}/bars/latest`, { feed }, requestOptions)
  ]);
  const quote = q.body?.quote || q.body?.quotes?.[ticker] || null;
  const trade = t.body?.trade || t.body?.trades?.[ticker] || null;
  const bar = b.body?.bar || b.body?.bars?.[ticker] || null;
  const raw = {
    provider: "alpaca",
    feed,
    symbol: ticker,
    observedAt: new Date(Number(options.nowMs || Date.now())).toISOString(),
    quote: { bid: Number(quote?.bp ?? quote?.bid_price), ask: Number(quote?.ap ?? quote?.ask_price), timestamp: quote?.t || quote?.timestamp || null },
    trade: { last: Number(trade?.p ?? trade?.price), timestamp: trade?.t || trade?.timestamp || null },
    bar: { open: Number(bar?.o), high: Number(bar?.h), low: Number(bar?.l), close: Number(bar?.c), volume: Number(bar?.v ?? bar?.volume), timestamp: bar?.t || bar?.timestamp || null },
    latencyMs: Math.max(q.latencyMs, t.latencyMs, b.latencyMs)
  };
  return { ...raw, ...assessMarketSnapshot(raw, options) };
}

export async function certifyAlpacaConnection(options = {}) {
  if (!alpacaConfigured()) return { provider: "alpaca", configured: false, authenticated: false, certified: false, fresh: false, schemaValid: false, reason: "credentials_missing", checkedAt: new Date().toISOString() };
  try {
    const snapshot = await latestStockSnapshot(options.symbol || "AAPL", options);
    return {
      provider: "alpaca",
      configured: true,
      authenticated: true,
      certified: snapshot.certified,
      schemaValid: snapshot.schemaValid,
      fresh: snapshot.fresh,
      coherent: snapshot.coherent,
      failures: snapshot.failures,
      feed: snapshot.feed,
      latencyMs: snapshot.latencyMs,
      checkedAt: new Date().toISOString(),
      sample: { symbol: snapshot.symbol, quoteTimestamp: snapshot.quote.timestamp, tradeTimestamp: snapshot.trade.timestamp, barTimestamp: snapshot.bar.timestamp, spreadBps: snapshot.spreadBps }
    };
  } catch (error) {
    return { provider: "alpaca", configured: true, authenticated: false, certified: false, fresh: false, schemaValid: false, failures: ["provider_error"], reason: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() };
  }
}

export function liveTradingReadiness({ marketCertification, orderApproval, risk = {} } = {}) {
  const blockers = [];
  if (!marketCertification?.certified) blockers.push("market_data_not_certified");
  if (orderApproval?.approved !== true || !orderApproval?.orderId) blockers.push("specific_order_approval_required");
  if (risk.killSwitch === true) blockers.push("kill_switch_active");
  if (risk.dailyLossLimitBreached === true) blockers.push("daily_loss_limit_breached");
  if (risk.positionSizeValid !== true) blockers.push("position_size_not_verified");
  return { ready: blockers.length === 0, blockers, mode: "real_money_approval_gated" };
}
