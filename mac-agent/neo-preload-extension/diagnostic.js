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
