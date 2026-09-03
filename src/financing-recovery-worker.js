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
    recordDownstreamFailure: (intent, error) => complete(intent, "blocked", { contract: "georgie.prism-handoff.v1", error }),
    recordDownstreamReceipt: (intent, receipt) => complete(intent, "completed", { contract: "georgie.prism-handoff.v1", receipt })
  };
}

export async function runFinancingRecoveryCycle({ store = supabaseRecoveryStore(), claim = body => recoveryRpc("georgie_claim_recovery_intents", body), prismAdapter = null } = {}) {
  const rows = await claim({ p_limit: 10, p_lease_seconds: 60 });
  for (const row of rows || []) {
    const intent = { ...(row.payload || {}), ...row };
    await processRecoveryIntent(store, intent, { prismAdapter }).catch(error => console.warn("Recovery intent persisted failure:", error.message));
  }
  return { claimed: rows?.length || 0 };
}

export function startFinancingRecoveryWorker({ schedule = setInterval } = {}) {
  if (process.env.GEORGIE_FINANCING_RECOVERY_ENABLED !== "true") return null;
  if (!url() || !key()) throw new Error("Financing recovery requires Supabase");
  const timer = schedule(() => runFinancingRecoveryCycle().catch(error => console.error(error)), Number(process.env.GEORGIE_FINANCING_RECOVERY_INTERVAL_MS || 15000));
  timer?.unref?.();
  return timer;
}
