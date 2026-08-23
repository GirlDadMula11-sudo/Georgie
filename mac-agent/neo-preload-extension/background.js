let lastInjection = null;

function sanitizeMessage(error) {
  return String(error?.message || error || "unknown").replace(/[\r\n]/g, " ").slice(0, 240);
}

async function injectMainWorld(details) {
  if (details.frameId !== 0 || !String(details.url || "").startsWith("https://app.neo.space/")) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId, frameIds: [0] },
      files: ["preload.js"],
      world: "MAIN",
      injectImmediately: true
    });
    lastInjection = { ok: true, code: "WEBNAVIGATION_MAIN_INJECTED", message: null, tabId: details.tabId };
  } catch (error) {
    lastInjection = { ok: false, code: "WEBNAVIGATION_MAIN_INJECTION_FAILED", message: sanitizeMessage(error), tabId: details.tabId };
  }
}

chrome.webNavigation.onCommitted.addListener(
  details => { void injectMainWorld(details); },
  { url: [{ schemes: ["https"], hostEquals: "app.neo.space" }] }
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GEORGIE_NEO_EXTENSION_DIAGNOSTIC") return false;
  const sameTab = lastInjection && sender.tab?.id === lastInjection.tabId;
  sendResponse(sameTab ? lastInjection : { ok: true, code: "WEBNAVIGATION_MAIN_BRIDGE_ARMED", message: null });
  return false;
});
