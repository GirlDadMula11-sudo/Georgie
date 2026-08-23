const BASE = "https://data.alpaca.markets";
const DEFAULT_FEED = "iex";
const DEFAULT_MAX_AGE_MS = 15_000;

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

function headers() {
  const { key, secret } = credentials();
  if (!key || !secret) throw new Error("Alpaca market data credentials are not configured");
  return { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, Accept: "application/json" };
}

async function get(path, params = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1500, Number(process.env.GEORGIE_MARKET_DATA_TIMEOUT_MS || 5000)));
  try {
    const response = await fetch(url, { headers: headers(), signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 500) }; }
    if (!response.ok) {
      const err = new Error(`Alpaca market data HTTP ${response.status}: ${body?.message || response.statusText}`);
      err.status = response.status;
      throw err;
    }
    return { body, latencyMs: Date.now() - started, rateLimit: { limit: response.headers.get("x-ratelimit-limit"), remaining: response.headers.get("x-ratelimit-remaining"), reset: response.headers.get("x-ratelimit-reset") } };
  } finally { clearTimeout(timeout); }
}

function ageMs(ts) {
  const t = Date.parse(ts || "");
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : null;
}

export async function latestStockSnapshot(symbol, options = {}) {
  const ticker = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) throw new Error("invalid stock symbol");
  const feed = String(options.feed || process.env.GEORGIE_ALPACA_FEED || DEFAULT_FEED).toLowerCase();
  const [q, t, b] = await Promise.all([
    get(`/v2/stocks/${encodeURIComponent(ticker)}/quotes/latest`, { feed }),
    get(`/v2/stocks/${encodeURIComponent(ticker)}/trades/latest`, { feed }),
    get(`/v2/stocks/${encodeURIComponent(ticker)}/bars/latest`, { feed })
  ]);
  const quote = q.body?.quote || q.body?.quotes?.[ticker] || null;
  const trade = t.body?.trade || t.body?.trades?.[ticker] || null;
  const bar = b.body?.bar || b.body?.bars?.[ticker] || null;
  const observedAt = new Date().toISOString();
  const quoteTs = quote?.t || quote?.timestamp || null;
  const tradeTs = trade?.t || trade?.timestamp || null;
  const barTs = bar?.t || bar?.timestamp || null;
  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs || process.env.GEORGIE_MARKET_DATA_MAX_AGE_MS || DEFAULT_MAX_AGE_MS));
  const bid = Number(quote?.bp ?? quote?.bid_price);
  const ask = Number(quote?.ap ?? quote?.ask_price);
  const last = Number(trade?.p ?? trade?.price);
  const volume = Number(bar?.v ?? bar?.volume);
  const ages = { quoteMs: ageMs(quoteTs), tradeMs: ageMs(tradeTs), barMs: ageMs(barTs) };
  const schemaValid = [bid, ask, last, volume].every(Number.isFinite) && bid > 0 && ask >= bid && last > 0 && volume >= 0;
  const freshestAge = Math.max(...[ages.quoteMs, ages.tradeMs].filter(Number.isFinite));
  const fresh = schemaValid && Number.isFinite(freshestAge) && freshestAge <= maxAgeMs;
  return {
    provider: "alpaca",
    feed,
    symbol: ticker,
    observedAt,
    quote: { bid, ask, timestamp: quoteTs, ageMs: ages.quoteMs },
    trade: { last, timestamp: tradeTs, ageMs: ages.tradeMs },
    bar: { open: Number(bar?.o), high: Number(bar?.h), low: Number(bar?.l), close: Number(bar?.c), volume, timestamp: barTs, ageMs: ages.barMs },
    spreadBps: bid > 0 && ask >= bid ? ((ask - bid) / ((ask + bid) / 2)) * 10_000 : null,
    latencyMs: Math.max(q.latencyMs, t.latencyMs, b.latencyMs),
    schemaValid,
    fresh,
    maxAgeMs,
    rateLimit: q.rateLimit
  };
}

export async function certifyAlpacaConnection({ symbol = "AAPL" } = {}) {
  if (!alpacaConfigured()) return { provider: "alpaca", configured: false, authenticated: false, schemaValid: false, fresh: false, certified: false, reason: "credentials_missing", checkedAt: new Date().toISOString() };
  try {
    const snapshot = await latestStockSnapshot(symbol);
    return {
      provider: "alpaca",
      configured: true,
      authenticated: true,
      schemaValid: snapshot.schemaValid,
      fresh: snapshot.fresh,
      certified: snapshot.schemaValid,
      feed: snapshot.feed,
      latencyMs: snapshot.latencyMs,
      checkedAt: new Date().toISOString(),
      freshnessNote: snapshot.fresh ? "quote/trade freshness passed" : "authenticated/schema-valid; freshness not certified for this observation window",
      sample: { symbol: snapshot.symbol, quoteTimestamp: snapshot.quote.timestamp, tradeTimestamp: snapshot.trade.timestamp, barTimestamp: snapshot.bar.timestamp }
    };
  } catch (error) {
    return { provider: "alpaca", configured: true, authenticated: false, schemaValid: false, fresh: false, certified: false, reason: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() };
  }
}
