const registration = {
  id: "georgie-neo-main-world-preload",
  matches: ["https://app.neo.space/*"],
  js: ["preload.js"],
  runAt: "document_start",
  world: "MAIN",
  persistAcrossSessions: true
};

async function register() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [registration.id] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [registration.id] });
  await chrome.scripting.registerContentScripts([registration]);
}

chrome.runtime.onInstalled.addListener(() => { void register(); });
chrome.runtime.onStartup.addListener(() => { void register(); });
void register();
