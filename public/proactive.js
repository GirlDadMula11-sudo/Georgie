const userId = localStorage.getItem("georgie:userId");
const sessionId = localStorage.getItem("georgie:sessionId");
const headers = () => ({ "X-Georgie-User": userId || "primary", "X-Georgie-Session": sessionId || "default" });
let seen = new Set();

function surfaceEvent(event) {
  if (!event || seen.has(event.id)) return;
  seen.add(event.id);

  const card = document.createElement("aside");
  card.className = "proactive-alert";
  card.innerHTML = `<div><strong></strong><p></p></div><button type="button" aria-label="Dismiss notification">×</button>`;
  card.querySelector("strong").textContent = event.title;
  card.querySelector("p").textContent = event.body || "Georgie noticed something that needs your attention.";
  card.querySelector("button").addEventListener("click", () => card.remove());
  document.querySelector(".shell")?.prepend(card);

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(event.title, { body: event.body || "Georgie has an update for you.", icon: "/georgie-icon.svg", tag: event.id });
  }
}

async function acknowledge(id) {
  await fetch(`/api/events/${encodeURIComponent(id)}/ack`, { method: "POST", headers: headers() }).catch(() => {});
}

async function poll() {
  try {
    if (!userId) return;
    const response = await fetch("/api/events?status=pending&limit=10", { headers: headers() });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !Array.isArray(payload.events)) return;
    for (const event of payload.events.reverse()) {
      surfaceEvent(event);
      await acknowledge(event.id);
    }
  } catch (error) {
    console.warn("Proactive event polling unavailable", error);
  }
}

poll();
setInterval(poll, 30_000);
