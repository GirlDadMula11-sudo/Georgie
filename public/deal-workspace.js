import { authHeaders, georgieDeviceReady } from "./device-auth.js";

const form = document.querySelector("#dealWorkspaceForm");
const input = document.querySelector("#dealWorkspaceReference");
const view = document.querySelector("#dealWorkspaceView");
const list = document.querySelector("#dealWorkspaceList");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function percent(value) { const n = Number(value); return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "Unknown"; }
function time(value) { if (!value) return "Time unknown"; const date = new Date(value); return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString(); }
function evidenceList(items, empty) { return items?.length ? `<ul>${items.slice(0, 8).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>${esc(empty)}</p>`; }
function money(value) { const n = Number(value); return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n) : "Unknown"; }
function sourceBadge(citation) { if (!citation) return ""; const page = citation.page ? `p. ${esc(citation.page)}` : "page unknown"; return `<small class="source-badge">${esc(citation.filename || citation.documentId || "source")} · ${page}</small>`; }

function renderWorkspace(workspace) {
  const readiness = workspace.readiness || {};
  const conflicts = workspace.conflicts || [];
  const timeline = workspace.timeline || [];
  const approvals = workspace.approvals || [];
  const tasks = workspace.tasks || [];
  const documents = workspace.documentIntelligence || {};
  const applicationFields = documents.application?.fields || [];
  const statements = documents.bankStatements?.statements || [];
  const metrics = documents.bankStatements?.metrics || {};
  view.innerHTML = `
    <div class="deal-hero">
      <div><small>${esc(workspace.reference)}</small><h3>${esc(workspace.title || workspace.reference)}</h3><span class="deal-stage">${esc(workspace.currentStageLabel)}</span></div>
      <div class="readiness-orb ${esc(readiness.state)}"><strong>${percent(readiness.evidenceCoverage)}</strong><span>evidence</span></div>
    </div>
    <div class="deal-operating-view"><article class="${readiness.state === "ready" ? "active" : ""}"><span>READY</span><strong>${readiness.state === "ready" ? "Verified" : "Not yet"}</strong></article><article class="${readiness.state === "blocked" ? "active blocked" : ""}"><span>BLOCKED</span><strong>${Number(readiness.blockers || 0)} issue${Number(readiness.blockers || 0) === 1 ? "" : "s"}</strong></article><article class="active next"><span>NEXT ACTION</span><strong>${esc(workspace.nextAction)}</strong></article></div>
    <div class="deal-kpis"><article><small>Readiness</small><strong>${esc(readiness.state || "unknown")}</strong></article><article><small>Blockers</small><strong>${Number(readiness.blockers || 0)}</strong></article><article><small>Conflicts</small><strong>${conflicts.length}</strong></article><article><small>Approvals</small><strong>${approvals.length}</strong></article></div>
    <div class="deal-grid">
      <article><header><span>DOCUMENTS &amp; BLOCKERS</span></header>${evidenceList(workspace.blockers, "No verified blocker is currently recorded.")}</article>
      <article><header><span>UNDERWRITING</span><b>${esc(workspace.financialMetrics?.status || "unknown")}</b></header><p>Avg deposits: ${money(metrics.averageMonthlyDeposits)}<br>Avg balance: ${money(metrics.averageDailyBalance)}<br>NSFs: ${metrics.totalNsfs ?? "Unknown"} · Negative days: ${metrics.totalNegativeDays ?? "Unknown"}</p><small>${statements.length} statement month(s) cited</small></article>
      <article><header><span>LENDER FIT</span><b>${esc(workspace.lenderFit?.status || "unknown")}</b></header><p>${workspace.lenderFit?.evidence?.length ? `${workspace.lenderFit.evidence.length} verified lender source record(s).` : "Lender suitability remains unknown until evidence is returned."}</p></article>
      <article><header><span>EXPECTED ECONOMICS</span><b>${esc(workspace.expectedEconomics?.status || "unknown")}</b></header><p>${esc(workspace.expectedEconomics?.note || "Verified economics unavailable.")}</p></article>
    </div>
    <details class="deal-evidence-section document-proof" open><summary>Application evidence <span>${documents.application?.completeness ? percent(documents.application.completeness.ratio) : "Unknown"}</span></summary><div class="field-proof-grid">${applicationFields.length ? applicationFields.map((field) => `<article class="${esc(field.status)}"><header><strong>${esc(field.label)}</strong><span>${esc(field.status)}</span></header><p>${esc(field.value || (field.status === "conflict" ? "Conflicting values" : "Not found"))}</p>${field.observations?.[0] ? sourceBadge(field.observations[0].citation) : "<small class=\"source-badge\">No cited source</small>"}</article>`).join("") : "<p>No structured application extraction was returned.</p>"}</div></details>
    <details class="deal-evidence-section document-proof"><summary>Bank statement evidence <span>${statements.length}/${documents.bankStatements?.requiredMonths || 3}</span></summary><div class="statement-proof">${statements.length ? statements.map((statement) => `<article><header><strong>${esc(statement.month || "Month unknown")}</strong><span>${statement.accountLast4 ? `••••${esc(statement.accountLast4)}` : "Account unknown"}</span></header><div><span>Deposits <b>${money(statement.metrics?.totalDeposits)}</b></span><span>Avg balance <b>${money(statement.metrics?.averageDailyBalance)}</b></span><span>NSFs <b>${statement.metrics?.nsfCount ?? "?"}</b></span><span>Negative days <b>${statement.metrics?.negativeDays ?? "?"}</b></span></div>${sourceBadge(statement.citations?.month || Object.values(statement.citations || {})[0])}</article>`).join("") : "<p>No page-cited bank statement extraction was returned.</p>"}</div></details>
    <details class="deal-evidence-section" open><summary>Evidence timeline <span>${timeline.length}</span></summary><div class="deal-timeline">${timeline.length ? timeline.slice(0, 20).map((item) => `<div><i></i><section><small>${esc(item.label)} · ${time(item.timestamp)}</small><strong>${esc(item.state || "observed")}</strong><span>${esc(item.source || "source unknown")}${item.recordId ? ` · ${esc(item.recordId)}` : ""}</span></section></div>`).join("") : "<p>No source-linked events are available yet.</p>"}</div></details>
    <details class="deal-evidence-section"><summary>Conflicts and unknowns <span>${conflicts.length + (workspace.evidence?.unknowns?.length || 0)}</span></summary>${conflicts.length ? conflicts.map((item) => `<div class="deal-conflict"><strong>${esc(item.conflictId)}</strong><span>${esc(item.workflowStage)} · ${esc(item.status)}</span><p>${esc(item.recommendation || item.impact?.business || "Authority decision remains unresolved.")}</p></div>`).join("") : "<p>No unresolved guarded conflict was returned.</p>"}${evidenceList(workspace.evidence?.unknowns, "No explicit unknowns were returned.")}</details>
    <details class="deal-evidence-section"><summary>Tasks and approvals <span>${tasks.length + approvals.length}</span></summary>${tasks.length ? tasks.map((item) => `<div class="deal-action"><strong>${esc(item.title)}</strong><span>${esc(item.priority)} · ${esc(item.status)}</span></div>`).join("") : "<p>No open task is linked to this reference.</p>"}${approvals.length ? approvals.map((item) => `<div class="deal-action approval"><strong>${esc(item.title)}</strong><span>${esc(item.risk)} · approval ${esc(item.status)}</span></div>`).join("") : "<p>No pending approval is linked to this reference.</p>"}</details>
    <p class="deal-governance">Workspace memory is Sierra-scoped. Raw sensitive data is not copied into workspace state. Consequential actions remain approval-gated.</p>`;
}

async function openWorkspace(reference) {
  const ref = String(reference || "").trim();
  if (!ref) return;
  input.value = ref;
  view.innerHTML = `<div class="deal-loading"><i></i><strong>Reconstructing ${esc(ref)}</strong><span>Collecting independent evidence without overwriting contradictions…</span></div>`;
  try {
    await georgieDeviceReady;
    const response = await fetch(`/api/sierra/workspace/${encodeURIComponent(ref)}/refresh`, { method: "POST", headers: authHeaders() });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Workspace unavailable");
    renderWorkspace(payload.workspace);
    await loadList();
  } catch (error) {
    view.innerHTML = `<div class="deal-error"><strong>Workspace unavailable</strong><p>${esc(error.message || "The evidence workspace could not be refreshed.")}</p></div>`;
  }
}

async function loadList() {
  if (!list) return;
  try {
    await georgieDeviceReady;
    const response = await fetch("/api/sierra/workspaces?limit=8", { headers: authHeaders() });
    const payload = await response.json();
    if (!response.ok || !payload.ok) return;
    list.innerHTML = (payload.workspaces || []).map((item) => `<button type="button" data-reference="${esc(item.reference)}"><strong>${esc(item.reference)}</strong><span>${esc(item.currentStageLabel)} · ${esc(item.status)}</span></button>`).join("");
  } catch {}
}

form?.addEventListener("submit", (event) => { event.preventDefault(); openWorkspace(input.value); });
list?.addEventListener("click", (event) => { const button = event.target.closest("[data-reference]"); if (button) openWorkspace(button.dataset.reference); });
loadList();
