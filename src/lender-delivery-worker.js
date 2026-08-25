import { enqueueMacJob, listMacJobs } from "./mac/queue.js";

const SUPABASE_URL = () => String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = () => String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
const PRIMARY_USER = () => process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const POLL_MS = Math.max(2000, Math.min(30000, Number(process.env.GEORGIE_LENDER_DELIVERY_POLL_MS || 5000)));
const inflight = new Map();
let timer = null;
let running = false;

function configured() { return Boolean(SUPABASE_URL() && SERVICE_KEY()); }
async function rpc(name, body) {
  const response = await fetch(`${SUPABASE_URL()}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY(), authorization: `Bearer ${SERVICE_KEY()}`, "content-type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let value = null; try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  if (!response.ok) throw new Error(`SUPABASE_RPC_${name}_${response.status}:${typeof value === "string" ? value : value?.message || value?.error || "failed"}`);
  return value;
}
async function complete(event, outcome, receipt = {}, error = null) {
  return rpc("complete_lender_delivery_event_v1", { p_event_id: event.event_id, p_lease_token: event.lease_token, p_outcome: outcome, p_receipt: receipt, p_error: error });
}
async function claim(rule) {
  return rpc("claim_lender_delivery_event_v1", { p_rule_key: rule, p_worker: "georgie-lender-delivery-v1", p_lease_seconds: 600 });
}
async function processPortalClaim(event) {
  const job = await enqueueMacJob({
    userId: PRIMARY_USER(), deviceId: "primary-mac", action: "browser.lender_portal_submit",
    risk: "external_submission", reason: `Authorized Sierra lender portal submission: ${event.lender_name}`,
    idempotencyKey: `lender-portal:${event.event_id}`,
    args: {
      referralId: event.referral_id, placementId: event.placement_id, lenderId: event.lender_id,
      lenderName: event.lender_name, endpoint: event.endpoint, authority: "selected_lender_release",
      eventId: event.event_id, requiredAgentVersion: process.env.GEORGIE_REQUIRED_PORTAL_AGENT_VERSION || undefined
    }
  });
  inflight.set(job.id, event);
}
async function processApiClaim(event) {
  if (event.provider_adapter !== "idea_financial_v1") return complete(event, "blocked", { provider_adapter: event.provider_adapter }, "No governed API provider adapter is registered for this lender");
  const response = await fetch(`${SUPABASE_URL()}/functions/v1/run-idea-provider-delivery`, {
    method: "POST", headers: { "content-type": "application/json", "x-sierra-internal": SERVICE_KEY() },
    body: JSON.stringify({ placement_id: event.placement_id, event_id: event.event_id, lease_token: event.lease_token, environment: event.environment }),
    signal: AbortSignal.timeout(45000)
  });
  const out = await response.json().catch(() => ({}));
  if (response.ok && out.provider_confirmed) return complete(event, "provider_confirmed", out, null);
  if (response.status === 409 || out.blocked) return complete(event, "blocked", out, out.error || "Idea provider delivery blocked");
  return complete(event, "retry", out, out.error || `Idea provider delivery ${response.status}`);
}
async function reconcileMacJobs() {
  if (!inflight.size) return;
  const jobs = await listMacJobs(undefined, 500);
  for (const [jobId, event] of [...inflight.entries()]) {
    const job = jobs.find(item => item.id === jobId);
    if (!job || ["queued", "claimed"].includes(job.status)) continue;
    inflight.delete(jobId);
    if (job.status === "completed" && job.result?.providerConfirmed === true) await complete(event, "provider_confirmed", job.result, null);
    else if (job.status === "completed" && job.result?.blocked === true) await complete(event, "blocked", job.result, job.result?.reason || "Portal workflow blocked");
    else await complete(event, "retry", job.result || {}, job.error || "Portal worker did not return provider confirmation");
  }
}
async function tick() {
  if (running || !configured()) return; running = true;
  try {
    await reconcileMacJobs();
    if (inflight.size < 2) { const portal = await claim("lender_portal_delivery"); if (portal) await processPortalClaim(portal); }
    const api = await claim("lender_api_delivery"); if (api) await processApiClaim(api);
  } catch (error) { console.error("Governed lender delivery bridge failed:", error instanceof Error ? error.message : error); }
  finally { running = false; }
}
export function startLenderDeliveryWorker() {
  if (timer || !configured()) return;
  timer = setInterval(() => tick().catch(() => {}), POLL_MS); timer.unref?.();
  setTimeout(() => tick().catch(() => {}), 1000).unref?.();
  console.log(`Governed lender delivery bridge active (${POLL_MS}ms cadence).`);
}
