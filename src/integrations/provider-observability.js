const VERCEL_BASE = "https://api.vercel.com";
const RENDER_BASE = "https://api.render.com/v1";

function timeout(ms = 7000) { return AbortSignal.timeout(ms); }

async function jsonFetch(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(options.headers || {})
    },
    signal: options.signal || timeout()
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Provider request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export function vercelObservabilityConfigured() {
  return Boolean(process.env.GEORGIE_VERCEL_TOKEN && process.env.GEORGIE_VERCEL_TEAM_ID && process.env.GEORGIE_VERCEL_PROJECT_ID);
}

export function renderObservabilityConfigured() {
  return Boolean(process.env.GEORGIE_RENDER_API_KEY && process.env.GEORGIE_RENDER_WORKSPACE_ID && process.env.GEORGIE_RENDER_SERVICE_ID);
}

export async function getVercelObservability() {
  if (!vercelObservabilityConfigured()) throw new Error("Vercel observability is not configured");
  const token = process.env.GEORGIE_VERCEL_TOKEN;
  const teamId = process.env.GEORGIE_VERCEL_TEAM_ID;
  const projectId = process.env.GEORGIE_VERCEL_PROJECT_ID;
  const qs = new URLSearchParams({ projectId, teamId, limit: "5" });
  const deploymentsPayload = await jsonFetch(`${VERCEL_BASE}/v6/deployments?${qs}`, token);
  const deployments = Array.isArray(deploymentsPayload?.deployments) ? deploymentsPayload.deployments : [];
  const latest = deployments.find((d) => d?.target === "production") || deployments[0] || null;

  let runtimeLogs = [];
  if (latest?.uid || latest?.id) {
    const deploymentId = latest.uid || latest.id;
    const logUrl = `${VERCEL_BASE}/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/runtime-logs?teamId=${encodeURIComponent(teamId)}`;
    try {
      const logsPayload = await jsonFetch(logUrl, token, { headers: { accept: "application/json" } });
      runtimeLogs = Array.isArray(logsPayload) ? logsPayload.slice(-80) : Array.isArray(logsPayload?.logs) ? logsPayload.logs.slice(-80) : [];
    } catch (error) {
      runtimeLogs = [{ level: "warning", message: `Runtime log read failed: ${error instanceof Error ? error.message : error}` }];
    }
  }

  const errorLogs = runtimeLogs.filter((row) => {
    const level = String(row?.level || "").toLowerCase();
    const status = Number(row?.responseStatusCode || row?.statusCode || 0);
    return ["error", "fatal"].includes(level) || status >= 500;
  }).slice(-20);

  return {
    provider: "vercel",
    projectId,
    latestDeployment: latest ? {
      id: latest.uid || latest.id || null,
      state: latest.state || latest.readyState || null,
      target: latest.target || null,
      url: latest.url || null,
      createdAt: latest.createdAt || latest.created || null,
      commitSha: latest.meta?.githubCommitSha || null,
      commitMessage: latest.meta?.githubCommitMessage || null
    } : null,
    recentDeployments: deployments.slice(0, 5).map((d) => ({ id: d.uid || d.id, state: d.state || d.readyState, target: d.target, createdAt: d.createdAt || d.created })),
    errorCount: errorLogs.length,
    recentErrors: errorLogs,
    checkedAt: new Date().toISOString()
  };
}

export async function getRenderObservability() {
  if (!renderObservabilityConfigured()) throw new Error("Render observability is not configured");
  const token = process.env.GEORGIE_RENDER_API_KEY;
  const ownerId = process.env.GEORGIE_RENDER_WORKSPACE_ID;
  const serviceId = process.env.GEORGIE_RENDER_SERVICE_ID;

  const deploysPayload = await jsonFetch(`${RENDER_BASE}/services/${encodeURIComponent(serviceId)}/deploys?limit=5`, token);
  const deployItems = Array.isArray(deploysPayload) ? deploysPayload : [];
  const deploys = deployItems.map((item) => item?.deploy || item).filter(Boolean);
  const latest = deploys[0] || null;

  const now = new Date();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const logQs = new URLSearchParams({
    ownerId,
    startTime: start,
    endTime: now.toISOString(),
    direction: "backward",
    limit: "80"
  });
  logQs.append("resource", serviceId);
  let logs = [];
  try {
    const logsPayload = await jsonFetch(`${RENDER_BASE}/logs?${logQs}`, token);
    logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  } catch (error) {
    logs = [{ labels: [{ name: "level", value: "warning" }], message: `Render log read failed: ${error instanceof Error ? error.message : error}` }];
  }

  const errors = logs.filter((row) => {
    const labels = Array.isArray(row?.labels) ? row.labels : [];
    const level = labels.find((x) => x?.name === "level")?.value || row?.level || "";
    return ["error", "fatal"].includes(String(level).toLowerCase());
  }).slice(0, 20);

  return {
    provider: "render",
    serviceId,
    latestDeployment: latest ? {
      id: latest.id || null,
      status: latest.status || null,
      createdAt: latest.createdAt || null,
      startedAt: latest.startedAt || null,
      finishedAt: latest.finishedAt || null,
      commitId: latest.commit?.id || latest.commitId || null,
      commitMessage: latest.commit?.message || null
    } : null,
    recentDeployments: deploys.slice(0, 5).map((d) => ({ id: d.id, status: d.status, createdAt: d.createdAt, commitId: d.commit?.id || d.commitId || null })),
    errorCount: errors.length,
    recentErrors: errors.map((row) => ({ timestamp: row.timestamp || null, message: String(row.message || "").slice(0, 1000), labels: row.labels || [] })),
    checkedAt: new Date().toISOString()
  };
}

export async function getProviderObservability() {
  const [vercel, render] = await Promise.allSettled([
    getVercelObservability(),
    getRenderObservability()
  ]);
  return {
    vercel: vercel.status === "fulfilled" ? { ok: true, ...vercel.value } : { ok: false, configured: vercelObservabilityConfigured(), error: vercel.reason instanceof Error ? vercel.reason.message : String(vercel.reason) },
    render: render.status === "fulfilled" ? { ok: true, ...render.value } : { ok: false, configured: renderObservabilityConfigured(), error: render.reason instanceof Error ? render.reason.message : String(render.reason) },
    checkedAt: new Date().toISOString()
  };
}
