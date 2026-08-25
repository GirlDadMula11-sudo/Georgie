import crypto from "node:crypto";
import express from "express";

const codes = new Map();
const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);
const origin = () => clean(process.env.GEORGIE_PUBLIC_ORIGIN || "https://georgie.onrender.com", 500).replace(/\/$/, "");
const hmacSecret = () => clean(process.env.GEORGIE_CONNECTOR_TOKEN, 500);
const configuredClient = () => ({
  id: clean(process.env.GEORGIE_OAUTH_CLIENT_ID, 300),
  secret: clean(process.env.GEORGIE_OAUTH_CLIENT_SECRET, 500),
  redirectUri: clean(process.env.GEORGIE_OAUTH_REDIRECT_URI, 1000)
});
const b64 = value => Buffer.from(value).toString("base64url");
const unb64 = value => Buffer.from(value, "base64url").toString("utf8");
const sign = value => crypto.createHmac("sha256", hmacSecret()).update(value).digest("base64url");
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const pkce = verifier => crypto.createHash("sha256").update(String(verifier || "")).digest("base64url");
const accessTtlSeconds = () => Math.max(300, Math.min(86400, Number(process.env.GEORGIE_OAUTH_ACCESS_TTL_SECONDS || 3600)));
const refreshTtlSeconds = () => Math.max(86400, Math.min(31536000, Number(process.env.GEORGIE_OAUTH_REFRESH_TTL_SECONDS || 2592000)));

function issueSignedToken({ clientId, scope, ttlSeconds, tokenUse }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({
    iss: origin(), aud: `${origin()}/mcp`, sub: clean(clientId, 300),
    scope: clean(scope, 500), token_use: tokenUse, iat: now,
    exp: now + ttlSeconds, jti: crypto.randomUUID()
  }));
  return `${payload}.${sign(payload)}`;
}

function verifySignedToken(token, expectedUse) {
  const [payload, signature] = clean(token, 5000).split(".");
  if (!payload || !signature || !hmacSecret() || !safeEqual(signature, sign(payload))) return null;
  try {
    const claims = JSON.parse(unb64(payload));
    const valid = claims.iss === origin() && claims.aud === `${origin()}/mcp` &&
      Number(claims.exp) > Math.floor(Date.now() / 1000) &&
      clean(claims.sub, 300) === configuredClient().id && claims.token_use === expectedUse;
    return valid ? claims : null;
  } catch { return null; }
}

function tokenResponse({ clientId, scope }) {
  return {
    access_token: issueSignedToken({ clientId, scope, ttlSeconds: accessTtlSeconds(), tokenUse: "access" }),
    refresh_token: issueSignedToken({ clientId, scope, ttlSeconds: refreshTtlSeconds(), tokenUse: "refresh" }),
    token_type: "Bearer", expires_in: accessTtlSeconds(), scope
  };
}

export function connectorRegistrationStatus() {
  const base = origin();
  const client = configuredClient();
  const configured = {
    connectorToken: Boolean(hmacSecret()),
    oauthClientId: Boolean(client.id),
    oauthClientSecret: Boolean(client.secret),
    oauthRedirectUri: Boolean(client.redirectUri)
  };
  const missing = [];
  if (!configured.connectorToken) missing.push("GEORGIE_CONNECTOR_TOKEN");
  if (!configured.oauthClientId) missing.push("GEORGIE_OAUTH_CLIENT_ID");
  if (!configured.oauthClientSecret) missing.push("GEORGIE_OAUTH_CLIENT_SECRET");
  if (!configured.oauthRedirectUri) missing.push("GEORGIE_OAUTH_REDIRECT_URI");
  return {
    ready: missing.length === 0,
    origin: base,
    mcpEndpoint: `${base}/mcp`,
    oauthMetadata: `${base}/.well-known/oauth-authorization-server`,
    protectedResourceMetadata: `${base}/.well-known/oauth-protected-resource/mcp`,
    configured,
    missing
  };
}

export function issueConnectorAccessToken({ clientId, scope = "georgie:command georgie:status", ttlSeconds = 3600 } = {}) {
  return issueSignedToken({ clientId, scope, ttlSeconds, tokenUse: "access" });
}

export function verifyConnectorAccessToken(header) {
  const token = clean(String(header || "").replace(/^Bearer\s+/i, ""), 3000);
  return Boolean(verifySignedToken(token, "access"));
}

export function connectorHeartbeatSnapshot() {
  const status = connectorRegistrationStatus();
  return {
    ...status,
    authPersistence: status.ready ? "refresh_token_rotation" : "unavailable",
    accessTtlSeconds: accessTtlSeconds(),
    refreshTtlSeconds: refreshTtlSeconds(),
    heartbeatIntervalSeconds: 30,
    retryAfterSeconds: 5,
    checkedAt: new Date().toISOString()
  };
}

export function startConnectorHeartbeatMonitor({ intervalMs = 30000, logger = console } = {}) {
  let prior = null;
  const check = () => {
    const snapshot = connectorHeartbeatSnapshot();
    const state = snapshot.ready ? "ready" : `not_ready:${snapshot.missing.join(",")}`;
    if (state !== prior) logger[snapshot.ready ? "info" : "error"]?.(`[Georgie] connector heartbeat ${state}`);
    prior = state;
    return snapshot;
  };
  check();
  const timer = setInterval(check, Math.max(5000, intervalMs));
  timer.unref?.();
  return () => clearInterval(timer);
}

function clientSecret(req) {
  const header = clean(req.headers.authorization, 1200);
  if (/^Basic\s+/i.test(header)) {
    try { return Buffer.from(header.replace(/^Basic\s+/i, ""), "base64").toString("utf8").split(":").slice(1).join(":"); } catch {}
  }
  return clean(req.body?.client_secret, 500);
}

export function createConnectorOAuthRouter() {
  const router = express.Router();
  router.get("/.well-known/georgie-connector-readiness", (_req, res) => {
    const status = connectorHeartbeatSnapshot();
    res.set("Cache-Control", "no-store").status(status.ready ? 200 : 503).json(status);
  });
  router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json({
    resource: `${origin()}/mcp`,
    authorization_servers: [origin()],
    scopes_supported: ["georgie:command", "georgie:status"]
  }));
  router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({
    issuer: origin(),
    authorization_endpoint: `${origin()}/oauth/authorize`,
    token_endpoint: `${origin()}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    scopes_supported: ["georgie:command", "georgie:status"]
  }));
  router.get("/oauth/authorize", (req, res) => {
    const client = configuredClient();
    const clientId = clean(req.query.client_id, 300), redirectUri = clean(req.query.redirect_uri, 1000);
    const challenge = clean(req.query.code_challenge, 500), method = clean(req.query.code_challenge_method, 20);
    if (req.query.response_type !== "code" || !client.id || clientId !== client.id || !client.redirectUri || redirectUri !== client.redirectUri || !challenge || method !== "S256") return res.status(400).send("Invalid private connector authorization request");
    const code = crypto.randomBytes(32).toString("base64url");
    codes.set(code, { clientId, redirectUri, challenge, scope: clean(req.query.scope || "georgie:command georgie:status", 500), expiresAt: Date.now() + 120000 });
    const target = new URL(redirectUri); target.searchParams.set("code", code); if (req.query.state) target.searchParams.set("state", clean(req.query.state, 1000));
    res.redirect(302, target.toString());
  });
  router.post("/oauth/token", express.urlencoded({ extended: false }), (req, res) => {
    const client = configuredClient();
    if (req.body?.grant_type === "refresh_token") {
      if (!safeEqual(clientSecret(req), client.secret)) return res.status(401).json({ error: "invalid_client" });
      const claims = verifySignedToken(clean(req.body?.refresh_token, 5000), "refresh");
      if (!claims) return res.status(400).json({ error: "invalid_grant" });
      return res.set("Cache-Control", "no-store").json(tokenResponse({ clientId: client.id, scope: clean(claims.scope, 500) }));
    }
    const code = clean(req.body?.code, 500), item = codes.get(code);
    codes.delete(code);
    const valid = req.body?.grant_type === "authorization_code" && item && item.expiresAt > Date.now() && clean(req.body?.client_id || client.id, 300) === client.id && safeEqual(clientSecret(req), client.secret) && clean(req.body?.redirect_uri, 1000) === item.redirectUri && safeEqual(pkce(req.body?.code_verifier), item.challenge);
    if (!valid) return res.status(400).json({ error: "invalid_grant" });
    res.set("Cache-Control", "no-store").json(tokenResponse({ clientId: client.id, scope: item.scope }));
  });
  return router;
}
