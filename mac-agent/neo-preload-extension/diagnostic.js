function publish(result) {
  const safe = {
    ok: result?.ok === true,
    code: String(result?.code || "UNKNOWN").slice(0, 80),
    message: result?.message ? String(result.message).replace(/[\r\n]/g, " ").slice(0, 240) : null,
    isolatedWorldLoaded: true
  };
  document.documentElement.dataset.georgieNeoExtensionDiagnostic = JSON.stringify(safe);
}

try {
  chrome.runtime.sendMessage(
    { type: "GEORGIE_NEO_EXTENSION_DIAGNOSTIC" },
    response => {
      if (chrome.runtime.lastError) {
        publish({ ok: false, code: "SERVICE_WORKER_UNREACHABLE", message: chrome.runtime.lastError.message });
        return;
      }
      publish(response);
    }
  );
} catch (error) {
  publish({ ok: false, code: "SERVICE_WORKER_UNREACHABLE", message: error?.message });
}

async function handleDebuggerRequest() {
  const raw = document.documentElement.dataset.georgieNeoDebuggerRequest;
  if (!raw) return;
  let request;
  try { request = JSON.parse(raw); } catch { return; }
  if (!request?.id || request.type !== "verify_session") return;
  delete document.documentElement.dataset.georgieNeoDebuggerRequest;
  chrome.runtime.sendMessage({ type: "GEORGIE_NEO_DEBUGGER_VERIFY", mailboxes: request.mailboxes }, response => {
    const result = chrome.runtime.lastError ? { ok: false, code: "NEO_DEBUGGER_RELAY_UNREACHABLE", message: chrome.runtime.lastError.message } : response;
    document.documentElement.dataset.georgieNeoDebuggerResult = JSON.stringify({ id: request.id, ...result });
  });
}

new MutationObserver(handleDebuggerRequest).observe(document.documentElement, { attributes: true, attributeFilter: ["data-georgie-neo-debugger-request"] });
handleDebuggerRequest();
