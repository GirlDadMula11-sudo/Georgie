const registration = {
  id: "georgie-neo-main-world-preload",
  matches: ["https://app.neo.space/*"],
  js: ["preload.js"],
  runAt: "document_start",
  world: "MAIN",
  persistAcrossSessions: true
};

function sanitizeMessage(error) {
  return String(error?.message || error || "unknown").replace(/[\r\n]/g, " ").slice(0, 240);
}

async function register() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [registration.id] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [registration.id] });
    await chrome.scripting.registerContentScripts([registration]);
    const verified = await chrome.scripting.getRegisteredContentScripts({ ids: [registration.id] });
    if (!verified.length) return { ok: false, code: "REGISTRATION_NOT_READ_BACK", message: "registered content script was not returned" };
    return { ok: true, code: "REGISTERED", message: null };
  } catch (error) {
    return { ok: false, code: "REGISTRATION_EXCEPTION", message: sanitizeMessage(error) };
  }
}

chrome.runtime.onInstalled.addListener(() => { void register(); });
chrome.runtime.onStartup.addListener(() => { void register(); });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GEORGIE_NEO_EXTENSION_DIAGNOSTIC") return false;
  void register().then(sendResponse);
  return true;
});
void register();
