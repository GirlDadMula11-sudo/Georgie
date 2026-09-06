import { createPrismReviewAdapter } from "./integrations/financing-recovery-adapters.js";
import { processRecoveryIntent } from "./financing-recovery.js";

const url = () => String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const key = () => String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");

export async function recoveryRpc(name, body = {}, fetchImpl = fetch) {
  if (!url() || !key()) throw new Error("FINANCING_RECOVERY_DURABLE_STORE_REQUIRED");
  const response = await fetchImpl(`${url()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key(), authorization: `Bearer ${key()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`RECOVERY_RPC_${name}_${response.status}:${data?.message || "failed"}`);
  return data;
}

export function supabaseRecoveryStore({ rpc = recoveryRpc } = {}) {
  const complete = (intent, status, evidence) => rpc("georgie_complete_recovery_intent", { p_id: intent.id, p_lease: intent.lease_token, p_status: status, p_evidence: evidence });
  return {
    transactIntake: (candidate, intent) => rpc("georgie_recovery_ingest_candidate_v2", { p_candidate: candidate, p_intent: intent }),
    transactReply: reply => rpc("georgie_recovery_ingest_reply_v2", { p_reply: reply }),
    transactSuppression: event => rpc("georgie_recovery_ingest_suppression_v1", { p_event: event }),
    checkGlobalSuppression: intent => rpc("georgie_recovery_suppression", { p_intent_id: intent.id }),
    holdIntent: (intent, reason) => complete(intent, "held", { reason }),
    blockIntent: (intent, reason) => complete(intent, "suppressed", { reason }),
    recordProviderFailure: (intent, error) => complete(intent, "failed", { error }),
    recordProviderReceipt: (intent, receipt) => complete(intent, "sent", { provider: "neo", ...receipt }),
    recordPrismPrecontact: (intent, packet, secureLink) => rpc("georgie_complete_prism_precontact_v1", { p_id: intent.id, p_lease: intent.lease_token, p_packet: packet, p_secure_link: secureLink }),
    issueUploadToken: request => rpc("georgie_issue_recovery_upload_token_v1", { p_request: request }),
    resolveUploadToken: tokenHash => rpc("georgie_resolve_recovery_upload_token_v1", { p_token_hash: tokenHash }),
    getUploadSession: tokenHash => rpc("georgie_recovery_upload_session_v2", { p_token_hash: tokenHash }),
    revokeUploadToken: (tokenHash, evidenceId) => rpc("georgie_revoke_recovery_upload_token_v1", { p_token_hash: tokenHash, p_evidence_id: evidenceId }),
    transactChannelIntent: event => rpc("georgie_recovery_channel_intent_v1", { p_event: event }),
    transactSmsEvent: event => rpc("georgie_recovery_sms_event_v1", { p_event: event }),
    transactUploadCompletion: upload => rpc("georgie_complete_recovery_upload_v1", { p_upload: upload }),
    persistEvidence: evidence => rpc("georgie_ingest_recovery_evidence_v1", { p_evidence: evidence, p_quarantine_reason: null }),
    quarantineEvidence: (evidence, reason) => rpc("georgie_ingest_recovery_evidence_v1", { p_evidence: evidence, p_quarantine_reason: reason }),
    recordDownstreamFailure: (intent, error) => complete(intent, "blocked", { contract: "georgie.prism-handoff.v1", error }),
    recordDownstreamReceipt: (intent, receipt) => complete(intent, "completed", { contract: "georgie.prism-handoff.v1", receipt })
  };
}

export async function runFinancingRecoveryCycle({
  store = supabaseRecoveryStore(),
  claim = body => recoveryRpc("georgie_claim_recovery_intents", body),
  scheduleFollowups = body => recoveryRpc("georgie_schedule_recovery_followups_v1", body),
  prismAdapter = null,
  precontactReviewAdapter = createPrismReviewAdapter()
} = {}) {
  let lifecycle = null;
  try {
    lifecycle = await scheduleFollowups({ p_limit: 100 });
  } catch (error) {
    // Follow-up scheduling is additive. A scheduler/migration issue must not stop
    // existing recovery intents, uploads, Prism handoffs, or suppressions.
    console.warn("Recovery lifecycle scheduler unavailable:", error.message);
  }
  const rows = await claim({ p_limit: 10, p_lease_seconds: 60 });
  for (const row of rows || []) {
    const intent = { ...(row.payload || {}), ...row };
    await processRecoveryIntent(store, intent, { prismAdapter, precontactReviewAdapter }).catch(error => console.warn("Recovery intent persisted failure:", error.message));
  }
  return { claimed: rows?.length || 0, lifecycle };
}

export function startFinancingRecoveryWorker({ schedule = setInterval } = {}) {
  if (process.env.GEORGIE_FINANCING_RECOVERY_ENABLED !== "true") return null;
  if (!url() || !key()) throw new Error("Financing recovery requires Supabase");
  const timer = schedule(() => runFinancingRecoveryCycle().catch(error => console.error(error)), Number(process.env.GEORGIE_FINANCING_RECOVERY_INTERVAL_MS || 15000));
  timer?.unref?.();
  return timer;
}