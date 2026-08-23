(() => {
  "use strict";
  if (window.__georgieNeoPreload?.hookVersion) return;
  const installedAt = Date.now();
  const state = window.__georgieNeoPreload = {
    hookVersion: "1.0.0",
    executionBridge: "registered_main_world_document_start",
    installedAt,
    navigationStart: Number(performance.timeOrigin || 0),
    preNavigation: installedAt - Number(performance.timeOrigin || installedAt) < 5000,
    records: [], accountBindings: [], sources: [], responseSchemas: [], webSockets: [], mutations: [], errors: [],
    credentialsExported: false, requestBodiesCaptured: false, webSocketPayloadsCaptured: false,
    persistedMessageContent: false, mailboxMutation: false
  };
  const forbidden = /token|secret|password|authorization|session|cookie|credential|ssn|ein|routing|accountnumber/i;
  const mailish = /mail|message|thread|conversation|inbox|search|sync|ae\//i;
  const allowedHost = host => host === "app.neo.space" || host === "api.flockmail.com" || host === "bll.flockmail.com" || host.endsWith(".flockmail.com");
  const safeUrl = raw => { try { const u = new URL(String(raw || ""), location.href); if (u.protocol !== "https:" || !allowedHost(u.hostname.toLowerCase()) || [...u.searchParams.keys()].some(k => forbidden.test(k))) return null; return { origin: u.origin, path: u.pathname, queryKeys: [...u.searchParams.keys()].sort().slice(0, 30) }; } catch { return null; } };
  const scalar = (v, n = 200000) => typeof v === "string" || typeof v === "number" ? String(v).slice(0, n) : "";
  const first = (o, keys) => { for (const k of keys) { const v = scalar(o?.[k]); if (v) return v; } return ""; };
  const addSource = (source, method) => { const item = { ...source, method }; if (!state.sources.some(x => JSON.stringify(x) === JSON.stringify(item))) state.sources.push(item); };
  const walk = (value, source, depth = 0, seen = new WeakSet()) => {
    if (!value || typeof value !== "object" || depth > 9 || state.records.length >= 500 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const item of value.slice(0, 750)) walk(item, source, depth + 1, seen); return; }
    const keys = Object.keys(value).slice(0, 220);
    const idKey = keys.find(k => /^(messageId|message_id|mailId|mail_id|uid|messageUid|id)$/i.test(k) && !forbidden.test(k));
    const threadKey = keys.find(k => /^(threadId|thread_id|conversationId|conversation_id|threadUid)$/i.test(k) && !forbidden.test(k));
    const subject = first(value, ["subject", "title", "mailSubject", "messageSubject"]), sender = first(value, ["from", "sender", "fromAddress", "senderEmail"]);
    if (idKey && (subject || sender)) {
      const messageId = scalar(value[idKey], 500), threadId = threadKey ? scalar(value[threadKey], 500) : messageId;
      const content = first(value, ["plainText", "textBody", "body", "htmlBody", "html", "content", "messageBody"]);
      if (/^[A-Za-z0-9][A-Za-z0-9._~:@/-]{4,499}$/.test(messageId)) state.records.push({
        messageId, threadId: /^[A-Za-z0-9][A-Za-z0-9._~:@/-]{4,499}$/.test(threadId) ? threadId : messageId,
        subject: subject.slice(0, 1200), sender: sender.slice(0, 500),
        timestamp: first(value, ["receivedAt", "received_at", "sentAt", "sent_at", "date", "timestamp", "internalDate", "createdAt"]).slice(0, 120),
        content: content.slice(0, 200000), bodyComplete: Boolean(content && content.length < 200000),
        sourceEndpoint: source.path, sourceOrigin: source.origin, sourceMethod: "GET",
        identifierFields: { message: idKey, thread: threadKey || idKey }, identifierSource: "neo_pre_navigation_get"
      });
    }
    for (const key of keys) { if (forbidden.test(key) || /attachment(?:data|content)|raw/i.test(key)) continue; try { if (value[key] && typeof value[key] === "object") walk(value[key], source, depth + 1, seen); } catch {} }
  };
  const inspectJson = (value, source) => {
    const scanAccounts = (node, depth = 0, seen = new WeakSet()) => {
      if (!node || typeof node !== "object" || depth > 7 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { for (const item of node.slice(0, 500)) scanAccounts(item, depth + 1, seen); return; }
      const keys = Object.keys(node).slice(0, 180);
      const emailKey = keys.find(k => /^(email|emailAddress|address|username|login)$/i.test(k));
      const idKey = keys.find(k => /^(accountId|account_id|mailboxId|mailbox_id|userId|user_id|id|uid)$/i.test(k) && !forbidden.test(k));
      const email = emailKey ? scalar(node[emailKey], 320).trim().toLowerCase() : "";
      const accountId = idKey ? scalar(node[idKey], 500) : "";
      if (/^[^\s@]+@sierramarketinginc\.com$/i.test(email) && /^[A-Za-z0-9][A-Za-z0-9._~:@/-]{2,499}$/.test(accountId)) {
        const binding = { email, accountId, emailField: emailKey, idField: idKey, sourceEndpoint: source.path, sourceOrigin: source.origin, sourceMethod: "GET" };
        if (!state.accountBindings.some(x => x.email === email && x.accountId === accountId)) state.accountBindings.push(binding);
      }
      for (const key of keys) { if (forbidden.test(key)) continue; try { if (node[key] && typeof node[key] === "object") scanAccounts(node[key], depth + 1, seen); } catch {} }
    };
    scanAccounts(value);
    const sample = Array.isArray(value) ? value.find(x => x && typeof x === "object") : value;
    if (sample && typeof sample === "object") { const fields = Object.keys(sample).filter(k => !forbidden.test(k)).slice(0, 120); state.responseSchemas.push({ ...source, fields, idFields: fields.filter(k => /(?:^|_)(?:message|mail|thread|conversation)?_?(?:id|uid)$/i.test(k)) }); }
    walk(value, source);
  };
  const observe = async (response, method, raw) => {
    const source = safeUrl(raw); if (!source) return; addSource(source, method);
    if (!["GET", "HEAD"].includes(method)) { if (mailish.test(source.path)) { state.mutations.push({ ...source, method }); state.mailboxMutation = true; } return; }
    if (method !== "GET") return;
    const type = String(response.headers?.get?.("content-type") || ""), length = Number(response.headers?.get?.("content-length") || 0);
    if (type.includes("json") && (!length || length <= 5000000)) try { inspectJson(await response.clone().json(), source); } catch (e) { state.errors.push(String(e?.message || e).slice(0, 200)); }
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) { const method = String(init.method || input?.method || "GET").toUpperCase(), raw = typeof input === "string" ? input : input?.url; const response = await nativeFetch(input, init); void observe(response, method, raw); return response; };
  const nativeOpen = XMLHttpRequest.prototype.open, nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) { this.__georgieMethod = String(method || "GET").toUpperCase(); this.__georgieUrl = String(url || ""); return nativeOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function() { const xhr = this, method = xhr.__georgieMethod || "GET", source = safeUrl(xhr.__georgieUrl); if (source) { addSource(source, method); if (!["GET", "HEAD"].includes(method) && mailish.test(source.path)) { state.mutations.push({ ...source, method }); state.mailboxMutation = true; } else if (method === "GET") xhr.addEventListener("load", () => { const type = String(xhr.getResponseHeader("content-type") || ""); if (type.includes("json") && String(xhr.responseText || "").length <= 5000000) try { inspectJson(JSON.parse(xhr.responseText), source); } catch (e) { state.errors.push(String(e?.message || e).slice(0, 200)); } }, { once: true }); } return nativeSend.apply(this, arguments); };
  if (window.WebSocket) { const Native = window.WebSocket; window.WebSocket = function(raw, protocols) { const source = safeUrl(String(raw || "").replace(/^wss:/, "https:")); if (source) state.webSockets.push({ ...source, created: true, payloadCaptured: false }); return protocols === undefined ? new Native(raw) : new Native(raw, protocols); }; window.WebSocket.prototype = Native.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); }
})();
