import crypto from "node:crypto";
import express from "express";
import { authenticateNativeRequest } from "./mobile-auth.js";

const codes = new Map();
const approvals = new Map();
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
const READ_SCOPE = "georgie:status";
const COMMAND_SCOPE = "georgie:command";
const allowedScopes = new Set([READ_SCOPE, COMMAND_SCOPE, "offline_access"]);
const normalizeScopes = (value, { commands = false } = {}) => {
  const requested = clean(value, 500).split(/\s+/).filter(scope => allowedScopes.has(scope));
  const granted = new Set([READ_SCOPE]);
  if (commands && requested.includes(COMMAND_SCOPE)) granted.add(COMMAND_SCOPE);
  if (requested.includes("offline_access")) granted.add("offline_access");
  return [...granted].join(" ");
};
const validRedirectUri = value => {
  try {
    const url = new URL(clean(value, 1200));
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password;
  } catch { return false; }
};
const redirectMatches = (registered, actual) => {
  if (registered === actual) return true;
  try {
    const left = new URL(registered), right = new URL(actual);
    return left.protocol === "http:" && right.protocol === "http:" && left.hostname === "127.0.0.1" && right.hostname === "127.0.0.1" && left.pathname === right.pathname && left.search === right.search;
  } catch { return false; }
};

function issueSignedToken({ clientId, scope, ttlSeconds, tokenUse }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({
    iss: origin(), aud: `${origin()}/mcp`, sub: clean(clientId, 5000),
    scope: clean(scope, 500), token_use: tokenUse, iat: now,
    exp: now + ttlSeconds, jti: crypto.randomUUID()
  }));
  return `${payload}.${sign(payload)}`;
}

function issueDynamicClient({ redirectUris = [], clientName = "ChatGPT" } = {}) {
  const body = b64(JSON.stringify({ redirect_uris: redirectUris, client_name: clean(clientName, 200), token_endpoint_auth_method: "none", iat: Math.floor(Date.now() / 1000) }));
  return `dcr_${body}.${sign(`dcr_${body}`)}`;
}

function dynamicClient(clientId) {
  const value = clean(clientId, 5000);
  const [head, signature] = value.split(".");
  if (!head?.startsWith("dcr_") || !signature || !safeEqual(signature, sign(head))) return null;
  try {
    const data = JSON.parse(unb64(head.slice(4)));
    if (!Array.isArray(data.redirect_uris) || !data.redirect_uris.length) return null;
    return { ...data, id: value, public: true };
  } catch { return null; }
}

function registeredClient(clientId) {
  const fixed = configuredClient();
  if (clientId && clientId === fixed.id) return { ...fixed, public: false };
  return dynamicClient(clientId);
}

function verifySignedToken(token, expectedUse) {
  const [payload, signature] = clean(token, 5000).split(".");
  if (!payload || !signature || !hmacSecret() || !safeEqual(signature, sign(payload))) return null;
  try {
    const claims = JSON.parse(unb64(payload));
    const valid = claims.iss === origin() && claims.aud === `${origin()}/mcp` &&
      Number(claims.exp) > Math.floor(Date.now() / 1000) &&
      Boolean(registeredClient(clean(claims.sub, 5000))) && claims.token_use === expectedUse;
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
  return Boolean(connectorAccessClaims(header));
}

export function connectorAccessClaims(header) {
  const token = clean(String(header || "").replace(/^Bearer\s+/i, ""), 3000);
  return verifySignedToken(token, "access");
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

function approvalPage(requestId, requestedScope) {
  const commandRequested = clean(requestedScope, 500).split(/\s+/).includes(COMMAND_SCOPE);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Georgie</title><style>body{font:16px system-ui;background:#f7f7f8;color:#202123;margin:0}.card{max-width:560px;margin:10vh auto;background:white;padding:28px;border:1px solid #ddd;border-radius:16px}button{width:100%;padding:14px;border:0;border-radius:10px;background:#10a37f;color:white;font-weight:700}label{display:block;margin:18px 0}.muted{color:#666;font-size:14px}</style></head><body><main class="card"><h1>Connect Codex to Georgie</h1><p>Approve read-only access to Georgie's capability and objective status tools.</p>${commandRequested ? '<label><input id="commands" type="checkbox"> Also allow governed handoffs and revocation. Consequential execution remains approval-gated inside Georgie.</label>' : ''}<button id="approve">Approve this connection</button><p id="status" class="muted">This requires an enrolled Georgie device in this browser.</p></main><script>document.getElementById('approve').onclick=async()=>{const status=document.getElementById('status'),token=localStorage.getItem('georgie:deviceToken')||'';status.textContent='Authorizing…';const response=await fetch('/oauth/authorize/approve',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify({requestId:${JSON.stringify(requestId)},allowCommands:Boolean(document.getElementById('commands')?.checked)})});const payload=await response.json().catch(()=>({}));if(response.ok&&payload.redirect){location.assign(payload.redirect);return}status.textContent=payload.error||'Authorization failed. Open Georgie in this browser and enroll the device first.'}</script></body></html>`;
}

export function createConnectorOAuthRouter({ authenticateOwner = authenticateNativeRequest } = {}) {
  const router = express.Router();
  router.get("/.well-known/georgie-connector-readiness", (_req, res) => {
    const status = connectorHeartbeatSnapshot();
    res.set("Cache-Control", "no-store").status(status.ready ? 200 : 503).json(status);
  });
  router.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json({
    resource: `${origin()}/mcp`,
    authorization_servers: [origin()],
    scopes_supported: ["georgie:command", "georgie:status", "offline_access"]
  }));
  router.get("/.well-known/oauth-protected-resource", (_req, res) => res.json({
    resource: `${origin()}/mcp`, authorization_servers: [origin()], scopes_supported: ["georgie:command", "georgie:status", "offline_access"]
  }));
  router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({
    issuer: origin(),
    authorization_endpoint: `${origin()}/oauth/authorize`,
    token_endpoint: `${origin()}/oauth/token`,
    registration_endpoint: `${origin()}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    authorization_response_iss_parameter_supported: true,
    scopes_supported: ["georgie:command", "georgie:status", "offline_access"]
  }));
  router.post("/oauth/register", express.json({ limit: "64kb" }), (req, res) => {
    const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(value => clean(value, 1200)).filter(validRedirectUri).slice(0, 10) : [];
    if (!redirectUris.length || req.body?.token_endpoint_auth_method && req.body.token_endpoint_auth_method !== "none") return res.status(400).json({ error: "invalid_client_metadata" });
    const clientId = issueDynamicClient({ redirectUris, clientName: req.body?.client_name });
    res.status(201).set("Cache-Control", "no-store").json({ client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  });
  router.get("/oauth/authorize", (req, res) => {
    const clientId = clean(req.query.client_id, 5000), client = registeredClient(clientId);
    const redirectUri = clean(req.query.redirect_uri, 1200);
    const challenge = clean(req.query.code_challenge, 500), method = clean(req.query.code_challenge_method, 20);
    const allowedRedirect = client?.public ? client.redirect_uris.some(value => redirectMatches(value, redirectUri)) : redirectMatches(client?.redirectUri, redirectUri);
    if (req.query.response_type !== "code" || !client || !allowedRedirect || !challenge || method !== "S256" || clean(req.query.resource, 1000) && clean(req.query.resource, 1000) !== `${origin()}/mcp`) return res.status(400).send("Invalid connector authorization request");
    const requestId = crypto.randomBytes(24).toString("base64url");
    approvals.set(requestId, { clientId, redirectUri, challenge, resource: `${origin()}/mcp`, requestedScope: clean(req.query.scope || `${READ_SCOPE} offline_access`, 500), state: clean(req.query.state, 1000), expiresAt: Date.now() + 300000 });
    res.set("Cache-Control", "no-store").type("html").send(approvalPage(requestId, req.query.scope));
  });
  router.post("/oauth/authorize/approve", express.json({ limit: "16kb" }), async (req, res) => {
    try {
      const owner = await authenticateOwner(req);
      if (!owner) return res.status(401).json({ error: "Enrolled Georgie device authorization required" });
      const requestId = clean(req.body?.requestId, 200), item = approvals.get(requestId);
      approvals.delete(requestId);
      if (!item || item.expiresAt <= Date.now()) return res.status(400).json({ error: "Authorization request expired" });
      const scope = normalizeScopes(item.requestedScope, { commands: req.body?.allowCommands === true });
      const code = crypto.randomBytes(32).toString("base64url");
      codes.set(code, { clientId: item.clientId, redirectUri: item.redirectUri, challenge: item.challenge, resource: item.resource, scope, expiresAt: Date.now() + 120000 });
      const target = new URL(item.redirectUri); target.searchParams.set("code", code); target.searchParams.set("iss", origin()); if (item.state) target.searchParams.set("state", item.state);
      res.set("Cache-Control", "no-store").json({ ok: true, redirect: target.toString(), scope });
    } catch { res.status(503).json({ error: "Owner authorization unavailable" }); }
  });
  router.post("/oauth/token", express.urlencoded({ extended: false }), (req, res) => {
    const clientId = clean(req.body?.client_id || configuredClient().id, 5000), client = registeredClient(clientId);
    if (!client) return res.status(401).json({ error: "invalid_client" });
    const authenticated = client.public ? !clientSecret(req) : safeEqual(clientSecret(req), client.secret);
    if (req.body?.grant_type === "refresh_token") {
      if (!authenticated) return res.status(401).json({ error: "invalid_client" });
      const claims = verifySignedToken(clean(req.body?.refresh_token, 5000), "refresh");
      if (!claims || claims.sub !== clientId) return res.status(400).json({ error: "invalid_grant" });
      return res.set("Cache-Control", "no-store").json(tokenResponse({ clientId, scope: clean(claims.scope, 500) }));
    }
    const code = clean(req.body?.code, 500), item = codes.get(code);
    codes.delete(code);
    const valid = req.body?.grant_type === "authorization_code" && authenticated && item && item.expiresAt > Date.now() && item.clientId === clientId && clean(req.body?.redirect_uri, 1200) === item.redirectUri && (!req.body?.resource || clean(req.body.resource, 1000) === item.resource) && safeEqual(pkce(req.body?.code_verifier), item.challenge);
    if (!valid) return res.status(400).json({ error: "invalid_grant" });
    res.set("Cache-Control", "no-store").json(tokenResponse({ clientId, scope: item.scope }));
  });
  return router;
}
