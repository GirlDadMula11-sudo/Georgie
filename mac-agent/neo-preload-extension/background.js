function sanitizeMessage(error) {
  return String(error?.message || error || "unknown").replace(/[\r\n]/g, " ").slice(0, 240);
}

async function verifySession(tabId, mailboxes) {
  const target = { tabId };
  let attached = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!String(tab.url || "").startsWith("https://app.neo.space/")) throw new Error("NEO_DEBUGGER_TARGET_REJECTED");
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const wanted = [...new Set((mailboxes || []).map(value => String(value).trim().toLowerCase()))];
    if (!wanted.length || wanted.some(value => !/^[^@\s]+@sierramarketinginc\.com$/.test(value))) throw new Error("NEO_DEBUGGER_MAILBOX_SCOPE_REJECTED");
    const expression = `JSON.stringify((()=>{const wanted=${JSON.stringify(wanted)};const rails=[...document.querySelectorAll('aside,nav,[role="navigation"],[class*="account" i],[class*="sidebar" i]')];return{origin:location.origin,bindings:wanted.map(email=>({email,present:rails.some(node=>(node.innerText||node.textContent||'').toLowerCase().includes(email))})),messageContentAccessed:false,credentialsTransferred:false,mutationPerformed:false}})())`;
    const response = await chrome.debugger.sendCommand(target, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false, userGesture: false });
    const proof = JSON.parse(String(response?.result?.value || ""));
    if (proof.origin !== "https://app.neo.space") throw new Error("NEO_DEBUGGER_ORIGIN_NOT_PROVEN");
    for (const binding of proof.bindings || []) if (!binding.present) throw new Error(`NEO_DEBUGGER_MAILBOX_NOT_BOUND:${binding.email}`);
    return { ok: true, code: "NEO_DEBUGGER_SESSION_VERIFIED", provider: "chrome.debugger", origin: proof.origin, bindings: proof.bindings, authority: "read_only", messageContentAccessed: false, credentialsTransferred: false, mutationPerformed: false };
  } catch (error) {
    return { ok: false, code: "NEO_DEBUGGER_SESSION_NOT_VERIFIED", message: sanitizeMessage(error), authority: "read_only", messageContentAccessed: false, credentialsTransferred: false, mutationPerformed: false };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GEORGIE_NEO_EXTENSION_DIAGNOSTIC") {
    sendResponse({ ok: true, code: "NEO_DEBUGGER_RELAY_READY", message: null });
    return false;
  }
  if (message?.type !== "GEORGIE_NEO_DEBUGGER_VERIFY" || !sender.tab?.id) return false;
  verifySession(sender.tab.id, message.mailboxes).then(sendResponse);
  return true;
});
