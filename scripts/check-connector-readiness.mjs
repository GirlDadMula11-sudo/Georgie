const origin = String(process.env.GEORGIE_PUBLIC_ORIGIN || "https://georgie.onrender.com").replace(/\/$/, "");
const readinessUrl = `${origin}/.well-known/georgie-connector-readiness`;
const oauthUrl = `${origin}/.well-known/oauth-authorization-server`;
const resourceUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
const mcpUrl = `${origin}/mcp`;
const expectedServer = { name: "georgie-governed-connector-r2", version: "2.4.3" };

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { accept: "application/json", ...(options.headers || {}) } });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 1000) }; }
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

function fail(stage, details = {}) {
  console.error(JSON.stringify({ ok: false, stage, ...details, checkedAt: new Date().toISOString() }));
  process.exit(1);
}

const readiness = await fetchJson(readinessUrl);
if (!readiness.response.ok || readiness.body?.ready !== true) fail("registration_readiness", { status: readiness.response.status, body: readiness.body });

const oauth = await fetchJson(oauthUrl);
if (!oauth.response.ok || oauth.body?.issuer !== origin || oauth.body?.authorization_endpoint !== `${origin}/oauth/authorize` || oauth.body?.token_endpoint !== `${origin}/oauth/token`) {
  fail("oauth_metadata", { status: oauth.response.status, body: oauth.body });
}
if (!(oauth.body?.scopes_supported || []).includes("offline_access")) fail("oauth_offline_access", { status: oauth.response.status, body: oauth.body });

const resource = await fetchJson(resourceUrl);
if (!resource.response.ok || resource.body?.resource !== mcpUrl || !(resource.body?.authorization_servers || []).includes(origin)) {
  fail("protected_resource_metadata", { status: resource.response.status, body: resource.body });
}

const token = String(process.env.GEORGIE_CONNECTOR_TOKEN || "").trim();
let deepMcp = { attempted: false, initialized: false, requiredToolsPresent: false, toolCount: null, serverInfo: null };
if (token) {
  deepMcp.attempted = true;
  const commonHeaders = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const init = await fetchJson(mcpUrl, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "georgie-readiness-probe", version: "2.4.3" } } }),
  });
  deepMcp.serverInfo = init.body?.result?.serverInfo || null;
  if (!init.response.ok || deepMcp.serverInfo?.name !== expectedServer.name || deepMcp.serverInfo?.version !== expectedServer.version) fail("mcp_initialize", { status: init.response.status, expectedServer, body: init.body });
  deepMcp.initialized = true;

  const tools = await fetchJson(mcpUrl, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const names = new Set((tools.body?.result?.tools || []).map((tool) => tool?.name));
  const required = ["georgie_dispatch_command", "georgie_forward_approval", "georgie_get_command"];
  const missing = required.filter((name) => !names.has(name));
  if (!tools.response.ok || missing.length) fail("tool_manifest", { status: tools.response.status, missing, available: [...names] });
  deepMcp.requiredToolsPresent = true;
  deepMcp.toolCount = names.size;
}

console.log(JSON.stringify({ ok: true, origin, registrationGeneration: "r2", expectedServer, registrationReady: true, oauthMetadataValid: true, offlineAccessAdvertised: true, protectedResourceMetadataValid: true, deepMcp, checkedAt: new Date().toISOString() }));
