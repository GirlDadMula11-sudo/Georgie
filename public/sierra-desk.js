import {authHeaders,georgieDeviceReady} from "./device-auth.js";
const desk = document.querySelector("#sierraDesk");
const dealsEl = document.querySelector("#sierraDeals");
const healthEl = document.querySelector("#sierraHealth");
const activeEl = document.querySelector("#sierraActive");
const attentionEl = document.querySelector("#sierraAttention");
const lendersEl = document.querySelector("#sierraLenders");
const offersEl = document.querySelector("#sierraOffers");
const refreshButton = document.querySelector("#sierraRefresh");

async function loadSierraDeskStatus() {
  if (!desk) return;
  refreshButton.disabled = true;
  try {
    await georgieDeviceReady;
    const response = await fetch("/api/sierra/status",{headers:authHeaders()});
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Sierra connection unavailable");
    healthEl.textContent = payload.configured ? "SECURE DEVICE" : "NOT CONFIGURED";
    healthEl.dataset.state = payload.configured ? "healthy" : "unavailable";
    activeEl.textContent = "—";
    attentionEl.textContent = "—";
    lendersEl.textContent = "—";
    offersEl.textContent = "—";
    dealsEl.innerHTML = payload.configured
      ? "<p>Sierra workforce data is protected. Open Georgie on your securely activated iPhone to view live deals, underwriting, lender activity, offers and closing status.</p>"
      : "<p>Sierra workforce connection is not configured on this Georgie deployment.</p>";
  } catch (error) {
    healthEl.textContent = "UNAVAILABLE";
    healthEl.dataset.state = "unavailable";
    dealsEl.innerHTML = `<p>${error instanceof Error ? error.message : "Sierra connection unavailable"}</p>`;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton?.addEventListener("click", loadSierraDeskStatus);
loadSierraDeskStatus();
