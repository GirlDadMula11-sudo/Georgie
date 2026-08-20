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

async function probe(name, body = {}) {
  try { return { name, available: true, observedAt: new Date().toISOString(), data: await rpc(name, body) }; }
  catch (error) { return { name, available: false, observedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), data: null }; }
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

export async function getSierraApplyInventory(userId, { limit = 100, cursor = null, status = "all" } = {}) {
  return rpc("georgie_workforce_apply_inventory", { p_user_id:String(userId||"primary"), p_limit:Math.max(1,Math.min(Number(limit)||100,500)), p_cursor:cursor?String(cursor):null, p_status:String(status||"all") });
}

export async function getSierraAuditEvents(userId, { reference = null, limit = 100 } = {}) {
  return rpc("georgie_workforce_audit_events", { p_user_id:String(userId||"primary"), p_reference:reference?String(reference):null, p_limit:Math.max(1,Math.min(Number(limit)||100,500)) });
}

export async function getSierraDocumentManifest(userId, { reference = null, submissionId = null } = {}) {
  return rpc("georgie_workforce_document_manifest", { p_user_id:String(userId||"primary"), p_reference:reference?String(reference):null, p_submission_id:submissionId?String(submissionId):null });
}

export async function getSierraReconciliationInvariant(userId, { submissionId = null, limit = 250 } = {}) {
  return rpc("georgie_workforce_reconciliation_invariant", { p_user_id:String(userId||"primary"), p_submission_id:submissionId?String(submissionId):null, p_limit:Math.max(1,Math.min(Number(limit)||250,1000)) });
}

export async function getSierraGuardedLenderConflicts(userId, { reference = null, limit = 50 } = {}) {
  return rpc("georgie_workforce_guarded_lender_conflicts", { p_user_id:String(userId||"primary"), p_reference:reference?String(reference):null, p_limit:Math.max(1,Math.min(Number(limit)||50,200)) });
}

export async function getSierraGovernedAccess(userId) {
  const uid=String(userId||"primary");
  const probes=await Promise.all([
    probe("georgie_workforce_health",{p_user_id:uid}),
    probe("georgie_workforce_infrastructure",{p_user_id:uid}),
    probe("georgie_workforce_apply_inventory",{p_user_id:uid,p_limit:1,p_cursor:null,p_status:"all"}),
    probe("georgie_workforce_audit_events",{p_user_id:uid,p_reference:null,p_limit:1}),
    probe("georgie_workforce_guarded_lender_conflicts",{p_user_id:uid,p_reference:null,p_limit:1}),
    probe("georgie_workforce_document_manifest",{p_user_id:uid,p_reference:null,p_submission_id:null}),
    probe("georgie_workforce_reconciliation_invariant",{p_user_id:uid,p_submission_id:null,p_limit:1})
  ]);
  return { configured:ENABLED, authority:"read_first_prepare_only", observedAt:new Date().toISOString(), capabilities:probes, productionWritesRequireApproval:true, invariant:"Every Apply submission is linked to exactly one Sierra deal, confirmed duplicate, or quarantine record." };
}

export async function executeApprovedSierraChange(userId, { approvalId, actionType, idempotencyKey, provenance = {}, payload = {} } = {}) {
  return rpc("georgie_workforce_execute_approved_change", { p_user_id:String(userId||"primary"), p_approval_id:String(approvalId||""), p_action_type:String(actionType||""), p_idempotency_key:String(idempotencyKey||""), p_provenance:provenance&&typeof provenance==="object"?provenance:{}, p_payload:payload&&typeof payload==="object"?payload:{} });
}
