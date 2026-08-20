const SIERRA_URL = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const SIERRA_KEY = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
const ENABLED = Boolean(SIERRA_URL && SIERRA_KEY);

function headers() {
  return {
    "content-type": "application/json",
    apikey: SIERRA_KEY,
    authorization: `Bearer ${SIERRA_KEY}`
  };
}

async function rpc(name, body = {}) {
  if (!ENABLED) throw new Error("Sierra workforce connection is not configured");
  const response = await fetch(`${SIERRA_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${name} failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return response.json();
}

export function sierraWorkforceConfigured() {
  return ENABLED;
}

export async function getSierraPortfolio(userId, { limit = 25 } = {}) {
  return rpc("georgie_workforce_portfolio", {
    p_user_id: String(userId || "primary"),
    p_limit: Math.max(1, Math.min(Number(limit) || 25, 100))
  });
}

export async function getSierraDeal(userId, reference) {
  return rpc("georgie_workforce_deal", {
    p_user_id: String(userId || "primary"),
    p_reference: String(reference || "").trim()
  });
}

export async function getSierraHealth(userId) {
  return rpc("georgie_workforce_health", {
    p_user_id: String(userId || "primary")
  });
}

export async function getSierraInfrastructure(userId) {
  return rpc("georgie_workforce_infrastructure", {
    p_user_id: String(userId || "primary")
  });
}

export async function getSierraLenderResponses(userId, reference) {
  return rpc("georgie_workforce_lender_responses", {
    p_user_id: String(userId || "primary"),
    p_reference: String(reference || "").trim()
  });
}

export async function getSierraOffers(userId, reference) {
  return rpc("georgie_workforce_offers", {
    p_user_id: String(userId || "primary"),
    p_reference: String(reference || "").trim()
  });
}

export async function getSierraStrategy(userId) {
  return rpc("georgie_workforce_strategy", {
    p_user_id: String(userId || "primary")
  });
}

export async function getSierraNetworkGaps(userId) {
  return rpc("georgie_workforce_network_gaps", {
    p_user_id: String(userId || "primary")
  });
}

export async function queueSierraAction(userId, { reference, action, reason } = {}) {
  return rpc("georgie_workforce_queue_action", {
    p_user_id: String(userId || "primary"),
    p_reference: String(reference || "").trim(),
    p_action: String(action || "").trim(),
    p_reason: reason ? String(reason).slice(0, 1200) : null
  });
}
