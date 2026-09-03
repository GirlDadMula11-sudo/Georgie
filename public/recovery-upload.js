const $ = selector => document.querySelector(selector);
const loading = $("#loadingState"), errorState = $("#errorState"), uploadState = $("#uploadState"), successState = $("#successState");
let token = "", session = null;

const monthLabel = value => {
  const [year, month] = String(value).split("-").map(Number);
  return Number.isInteger(year) && month >= 1 && month <= 12 ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))) : "Requested month";
};
const showOnly = target => [loading, errorState, uploadState, successState].forEach(element => { element.hidden = element !== target; });
const readableError = code => ({
  UPLOAD_TOKEN_INVALID: ["This secure link is invalid", "Ask Georgie or Sierra support for a new secure link."],
  UPLOAD_SESSION_NOT_FOUND: ["This secure link is unavailable", "The link may have been replaced. Request a new secure link to continue."],
  expired: ["This secure link has expired", "For your protection, upload links expire. Request a fresh link to continue."],
  revoked: ["This secure link was revoked", "This session is closed. Contact Sierra if you still need to provide statements."],
  MALWARE_SCAN_CLEARANCE_REQUIRED: ["We could not safely accept that file", "Choose a clean statement downloaded directly from your bank, or contact Sierra support."],
  STATEMENT_MONTH_OR_BUSINESS_MISMATCH: ["That statement does not match this request", "Check the month and business name, then choose the correct complete statement."],
  CLEAN_PROVIDER_RECEIPT_REQUIRED: ["Upload confirmation was interrupted", "Your file was not marked complete. Retry the same file—duplicates are safely detected."],
  duplicate: ["This statement is already received", "No action is needed for this month."],
  network: ["The secure transfer was interrupted", "Your file was not marked complete. Check your connection and retry the same file."],
  invalid_file: ["Choose a supported statement file", "Use a PDF, JPG, or PNG file no larger than 10 MB."],
  default: ["We could not complete that upload", "Nothing was marked complete. Retry, or contact Sierra support for help."]
})[code] || readableError("default");

function showSessionError(code) {
  const [title, message] = readableError(code);
  $("#errorTitle").textContent = title; $("#errorMessage").textContent = message;
  $("#secureBadge").textContent = "Session unavailable";
  showOnly(errorState); $("#reissueButton").focus();
}

async function api(path, options = {}) {
  const response = await fetch(`/api/financing-recovery${path}`, { ...options, headers: { ...(options.headers || {}), "x-recovery-upload-token": token } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) { const error = new Error(payload.error || "network"); error.code = payload.error || "network"; throw error; }
  return payload;
}

function setSlotState(article, state, detail = "") {
  article.dataset.state = state;
  const pill = article.querySelector(".status-pill"), zone = article.querySelector(".drop-zone"), progress = article.querySelector(".file-progress"), status = article.querySelector(".file-status"), error = article.querySelector(".slot-error");
  const labels = { open: "Needed", uploading: "Uploading", scanning: "Checking", verified: "Verified", error: "Try again" };
  pill.textContent = labels[state] || "Needed"; status.textContent = detail || labels[state] || "";
  zone.hidden = ["uploading", "scanning", "verified"].includes(state); progress.hidden = !["uploading", "scanning"].includes(state);
  error.hidden = state !== "error"; if (state === "error") error.textContent = detail;
  if (state === "verified") { article.querySelector("input").disabled = true; article.querySelector(".remove-file").hidden = true; }
}

function updateProgress() {
  const verified = document.querySelectorAll('.statement-slot[data-state="verified"]').length;
  $("#progressText").textContent = `${verified} of 2 verified`;
  if (verified === 2) showOnly(successState);
}

async function uploadFile(article, month, file) {
  if (!file || file.size > 10 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) { const [, message] = readableError("invalid_file"); setSlotState(article, "error", message); return; }
  article.querySelector(".file-name").textContent = file.name;
  article.querySelector("progress").value = 22; setSlotState(article, "uploading", "Encrypting and uploading…");
  try {
    const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.readAsDataURL(file); });
    article.querySelector("progress").value = 64; setSlotState(article, "scanning", "Scanning and validating the statement…");
    const payload = await api("/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: { name: file.name, mimeType: file.type, base64 }, expectedMonth: month }) });
    article.querySelector("progress").value = 100;
    setSlotState(article, "verified", payload.result?.created === false ? "Already securely received" : "Securely received and verified");
    updateProgress();
  } catch (error) {
    const [, message] = readableError(error.code === "UPLOAD_TOKEN_INVALID" ? "expired" : error.code || "network"); setSlotState(article, "error", message);
    article.querySelector("input").value = ""; article.querySelector("input").focus();
  }
}

function renderSession(value) {
  session = value;
  if (["expired", "revoked"].includes(value.status)) return showSessionError(value.status);
  if (value.status !== "active") return showSessionError("UPLOAD_TOKEN_INVALID");
  $("#clientGreeting").textContent = value.firstName ? `Welcome, ${value.firstName}` : "Welcome";
  $("#businessName").textContent = value.businessName || "Your business statement request";
  const expiry = new Date(value.expiresAt); $("#expiryText").textContent = `Session expires ${expiry.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const list = $("#slotList"); list.replaceChildren();
  for (const slot of value.slots || []) {
    const article = $("#slotTemplate").content.firstElementChild.cloneNode(true); article.dataset.month = slot.month; article.querySelector("h3").textContent = monthLabel(slot.month);
    const input = article.querySelector("input"), zone = article.querySelector(".drop-zone");
    input.setAttribute("aria-label", `Choose ${monthLabel(slot.month)} business bank statement`);
    input.addEventListener("change", () => uploadFile(article, slot.month, input.files[0]));
    for (const eventName of ["dragenter", "dragover"]) zone.addEventListener(eventName, event => { event.preventDefault(); zone.dataset.drag = "true"; });
    for (const eventName of ["dragleave", "drop"]) zone.addEventListener(eventName, event => { event.preventDefault(); zone.dataset.drag = "false"; if (eventName === "drop") uploadFile(article, slot.month, event.dataTransfer.files[0]); });
    article.querySelector(".remove-file").addEventListener("click", () => { input.value = ""; setSlotState(article, "open"); input.focus(); });
    setSlotState(article, slot.status === "verified" ? "verified" : "open", slot.status === "verified" ? "Securely received and verified" : ""); list.append(article);
  }
  if (value.complete) return showOnly(successState);
  showOnly(uploadState); updateProgress(); $("#portalMain").focus();
}

async function start() {
  token = decodeURIComponent(location.hash.slice(1)); history.replaceState(null, "", "/recovery/");
  if (token.length < 32) return showSessionError("UPLOAD_TOKEN_INVALID");
  try { const payload = await api("/upload-session"); renderSession(payload.session); }
  catch (error) { showSessionError(error.code || "network"); }
}

$("#reissueButton").addEventListener("click", () => { location.href = "mailto:operations@sierracapitalfunding.com?subject=Please reissue my secure statement upload link"; });
start();
