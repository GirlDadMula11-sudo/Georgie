const origin = String(process.env.GEORGIE_PUBLIC_ORIGIN || "https://georgie.onrender.com").replace(/\/$/, "");
const readinessUrl = `${origin}/.well-known/georgie-connector-readiness`;
const mcpUrl = `${origin}/mcp`;

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

const readiness = await fetchJson(readinessUrl);
if (!readiness.response.ok || readiness.body?.ready !== true) {
  console.error(JSON.stringify({ ok: false, stage: "registration_readiness", status: readiness.response.status, body: readiness.body }));
  process.exit(1);
}

const init = await fetchJson(mcpUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.GEORGIE_CONNECTOR_TOKEN || ""}`,
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "georgie-readiness-probe", version: "1.0.0" } } }),
});
if (!init.response.ok || init.body?.result?.serverInfo?.name !== "georgie-governed-connector") {
  console.error(JSON.stringify({ ok: false, stage: "mcp_initialize", status: init.response.status, body: init.body }));
  process.exit(1);
}

const tools = await fetchJson(mcpUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.GEORGIE_CONNECTOR_TOKEN || ""}`,
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
});
const names = new Set((tools.body?.result?.tools || []).map((tool) => tool?.name));
const required = ["georgie_dispatch_command", "georgie_forward_approval", "georgie_get_command"];
const missing = required.filter((name) => !names.has(name));
if (!tools.response.ok || missing.length) {
  console.error(JSON.stringify({ ok: false, stage: "tool_manifest", status: tools.response.status, missing, available: [...names] }));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, origin, registrationReady: true, mcpInitialized: true, requiredToolsPresent: true, toolCount: names.size, checkedAt: new Date().toISOString() }));
