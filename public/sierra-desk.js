const desk = document.querySelector("#sierraDesk");
const dealsEl = document.querySelector("#sierraDeals");
const healthEl = document.querySelector("#sierraHealth");
const activeEl = document.querySelector("#sierraActive");
const attentionEl = document.querySelector("#sierraAttention");
const lendersEl = document.querySelector("#sierraLenders");
const offersEl = document.querySelector("#sierraOffers");
const refreshButton = document.querySelector("#sierraRefresh");

const userId = localStorage.getItem("georgie:userId") || "primary";
function headers() { return { "X-Georgie-User": userId }; }
function money(value) {
  const number = Number(value || 0);
  return number ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number) : "—";
}
function safe(value, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }

function askGeorgie(reference) {
  const input = document.querySelector("#textInput");
  const form = document.querySelector("#textForm");
  if (!input || !form) return;
  input.value = `Georgie, give me the complete Sierra desk brief for ${reference}. Tell me what matters, what is blocking it, lender activity, offers, and the next best action.`;
  input.focus();
  form.requestSubmit();
}

function renderDeals(deals) {
  dealsEl.innerHTML = "";
  if (!deals.length) {
    dealsEl.innerHTML = "<p>No active Sierra deals found.</p>";
    return;
  }
  for (const deal of deals.slice(0, 6)) {
    const article = document.createElement("article");
    article.className = "sierra-deal";
    const main = document.createElement("div");
    main.innerHTML = `<strong>${safe(deal.legal_business_name)}</strong><span>${safe(deal.reference_number)} · ${safe(deal.current_stage, "File Build")}</span><small>${safe(deal.next_action, "No immediate action")}</small>`;
    const side = document.createElement("div");
    side.className = "sierra-deal-side";
    const amount = document.createElement("span");
    amount.textContent = money(deal.requested_amount);
    const level = document.createElement("em");
    level.dataset.level = safe(deal.attention_level, "normal").toLowerCase();
    level.textContent = safe(deal.attention_level, "Normal");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Ask Georgie";
    button.addEventListener("click", () => askGeorgie(deal.reference_number));
    side.append(amount, level, button);
    article.append(main, side);
    dealsEl.append(article);
  }
}

async function loadSierraDesk() {
  if (!desk) return;
  refreshButton.disabled = true;
  healthEl.textContent = "Refreshing…";
  try {
    const [portfolioResponse, healthResponse] = await Promise.all([
      fetch("/api/sierra/portfolio?limit=30", { headers: headers() }),
      fetch("/api/sierra/health", { headers: headers() })
    ]);
    const portfolio = await portfolioResponse.json();
    const health = await healthResponse.json();
    if (!portfolioResponse.ok || !portfolio.ok) throw new Error(portfolio.error || "Sierra portfolio unavailable");
    const deals = Array.isArray(portfolio.deals) ? portfolio.deals : [];
    const needsAttention = deals.filter((deal) => ["high", "critical"].includes(String(deal.attention_level || "").toLowerCase())).length;
    const atLenders = deals.filter((deal) => Number(deal.submitted_lender_count || 0) > 0).length;
    const offers = deals.reduce((total, deal) => total + Number(deal.available_offers || 0), 0);
    activeEl.textContent = String(deals.length);
    attentionEl.textContent = String(needsAttention);
    lendersEl.textContent = String(atLenders);
    offersEl.textContent = String(offers);
    const healthStatus = health?.health?.health_status || "connected";
    healthEl.textContent = String(healthStatus).replaceAll("_", " ").toUpperCase();
    healthEl.dataset.state = healthStatus;
    renderDeals(deals);
  } catch (error) {
    console.warn("Sierra desk unavailable", error);
    healthEl.textContent = "UNAVAILABLE";
    healthEl.dataset.state = "unavailable";
    dealsEl.innerHTML = `<p>${error instanceof Error ? error.message : "Sierra connection unavailable"}</p>`;
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton?.addEventListener("click", loadSierraDesk);
loadSierraDesk();
setInterval(loadSierraDesk, 60000);
