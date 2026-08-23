const NEO_HOST_SUFFIX = "neo.space";

export function isAllowedNeoUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === NEO_HOST_SUFFIX || host.endsWith(`.${NEO_HOST_SUFFIX}`);
  } catch {
    return false;
  }
}

function neoIdentityObserver(requested) {
  const normalized = value => String(value || "").replace(/\u0000/g, "").trim().toLowerCase();
  const inAccountRail = element => {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left < innerWidth * 0.38 && rect.right < innerWidth * 0.55);
  };
  const values = element => [element.getAttribute?.("data-email"), element.getAttribute?.("data-account"), element.getAttribute?.("aria-label"), element.getAttribute?.("title"), element.textContent].filter(Boolean).map(normalized);
  const matches = new Set();
  for (const element of document.querySelectorAll("body *")) {
    if (!inAccountRail(element)) continue;
    const hits = requested.filter(identity => values(element).some(value => value.includes(identity)));
    if (hits.length === 1) matches.add(hits[0]);
  }
  return [...matches];
}

function neoAccountActivator(identity, requested) {
  const normalized = value => String(value || "").replace(/\u0000/g, "").trim().toLowerCase();
  const inAccountRail = element => {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left < innerWidth * 0.38 && rect.right < innerWidth * 0.55);
  };
  const values = element => [element.getAttribute?.("data-email"), element.getAttribute?.("data-account"), element.getAttribute?.("aria-label"), element.getAttribute?.("title"), element.textContent].filter(Boolean).map(normalized);
  const candidates = [...document.querySelectorAll("body *")].filter(inAccountRail).filter(element => {
    const hits = requested.filter(requestedIdentity => values(element).some(value => value.includes(requestedIdentity)));
    return hits.length === 1 && hits[0] === identity;
  }).sort((left, right) => {
    const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
    return a.width * a.height - b.width * b.height;
  });
  const control = candidates[0];
  if (!control) return { selected: false, identity, error: "exact mailbox account rail control not found", messageRowsClicked: false, messageOpened: false };
  control.click();
  return { selected: true, identity, accountRailProof: "exact_identity_left_rail", messageRowsClicked: false, messageOpened: false };
}

function neoMailboxObserver(mailbox, cursors, max) {
  const visible = element => Boolean(element && element.getClientRects().length);
  const text = (value, limit = 6000) => String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
  const selectors = ["[role='row']", "[data-message-id]", "[data-thread-id]", "[data-testid*='message']", "[data-testid*='mail-row']"];
  const rows = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))].filter(visible);
  const messages = [], rejected = [];
  for (const row of rows) {
    const rowText = text(row.innerText || row.textContent, 6000);
    if (rowText.length < 3) continue;
    const messageId = text(row.getAttribute("data-message-id") || row.getAttribute("data-id") || row.id, 500);
    if (!messageId) { rejected.push("missing immutable message id"); continue; }
    const time = row.querySelector("time");
    const rawTime = time?.getAttribute("datetime") || row.getAttribute("data-received-at") || row.getAttribute("data-date") || time?.textContent || "";
    const parsed = Date.parse(rawTime);
    if (!Number.isFinite(parsed)) { rejected.push("missing immutable timestamp"); continue; }
    const timestamp = new Date(parsed).toISOString(), cursor = cursors[mailbox];
    if (cursor && (timestamp < cursor.timestamp || (timestamp === cursor.timestamp && messageId <= cursor.messageId))) continue;
    const subjectNode = row.querySelector("[data-subject],[class*='subject'],[aria-label*='Subject']");
    const subject = text(subjectNode?.getAttribute("data-subject") || subjectNode?.textContent || rowText.split(/\n+/)[0], 1200);
    const addresses = [...rowText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)].map(match => match[0].toLowerCase());
    messages.push({ mailbox, messageId, threadId: text(row.getAttribute("data-thread-id") || messageId, 500), timestamp, sender: addresses[0] || "", recipients: [], subject, content: rowText, attachments: [], sourceUrl: text(location.origin + location.pathname, 1000) });
    if (messages.length >= max) break;
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.messageId.localeCompare(b.messageId));
  return { messages: messages.slice(0, max), rejected: [...new Set(rejected)].slice(0, 20), readOnly: true, navigationPerformed: false, messageOpeningPerformed: false, mailboxMutation: false };
}

export function buildNeoObservationScript({ mailboxes, cursors, limit }) {
  const requested = [...new Set((mailboxes || []).map(value => String(value).toLowerCase()))];
  const boundedLimit = Math.min(25, Math.max(1, Number(limit) || 25));
  const identityObserver = neoIdentityObserver.toString(), accountActivator = neoAccountActivator.toString(), mailboxObserver = neoMailboxObserver.toString();
  return `const requested=${JSON.stringify(requested)};const cursors=${JSON.stringify(cursors || {})};const max=${boundedLimit};const identityObserver=${JSON.stringify(identityObserver)};const accountActivator=${JSON.stringify(accountActivator)};const mailboxObserver=${JSON.stringify(mailboxObserver)};const result={provider:'neo_browser',mailboxes:{},messages:[],tabsInspected:0,navigationPerformed:false,accountSelectionPerformed:false,messageOpeningPerformed:false,mailboxMutation:false};const chrome=Application('Google Chrome');function clean(v,n=6000){return String(v||'').replace(/\\u0000/g,'').slice(0,n)}function neo(raw){try{const h=new URL(String(raw)).hostname.toLowerCase();return h==='neo.space'||h.endsWith('.neo.space')}catch{return false}}if(!chrome.running())throw new Error('NEO_BROWSER_NOT_RUNNING');for(const win of chrome.windows()){for(const tab of win.tabs()){const url=String(tab.url()||'');if(!neo(url))continue;result.tabsInspected++;let identities=[];try{identities=JSON.parse(tab.execute({javascript:'JSON.stringify(('+identityObserver+')('+JSON.stringify(requested)+'))'}))}catch(error){continue}for(const identity of identities){if(result.mailboxes[identity]){result.mailboxes[identity]={connected:false,error:'ambiguous mailbox identity across multiple NEO tabs'};continue}let selected;try{selected=JSON.parse(tab.execute({javascript:'JSON.stringify(('+accountActivator+')('+JSON.stringify(identity)+','+JSON.stringify(requested)+'))'}))}catch(error){selected={selected:false,error:clean(error.message||error,500)}}if(!selected.selected||selected.accountRailProof!=='exact_identity_left_rail'||selected.messageRowsClicked||selected.messageOpened){result.mailboxes[identity]={connected:false,error:selected.error||'safe mailbox account selection failed'};continue}result.accountSelectionPerformed=true;delay(1);let observed;try{observed=JSON.parse(tab.execute({javascript:'JSON.stringify(('+mailboxObserver+')('+JSON.stringify(identity)+','+JSON.stringify(cursors)+','+JSON.stringify(max)+'))'}))}catch(error){observed={messages:[],error:clean(error.message||error,500)}}result.mailboxes[identity]={connected:!observed.error,provider:'neo_browser',readOnly:true,error:observed.error||null,rejected:observed.rejected||[]};for(const message of observed.messages||[])result.messages.push(message)}}}for(const identity of requested)if(!result.mailboxes[identity])result.mailboxes[identity]={connected:false,error:'exact mailbox identity not found in authenticated NEO account rail'};result.messages.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.messageId.localeCompare(b.messageId));result.messages=result.messages.slice(0,max);JSON.stringify(result);`;
}

export function validateNeoObservation(observed, mailboxes) {
  if (!observed || observed.provider !== "neo_browser" || observed.navigationPerformed !== false || observed.messageOpeningPerformed !== false || observed.mailboxMutation !== false) throw new Error("NEO_READ_ONLY_PROOF_FAILED");
  for (const mailbox of mailboxes) {
    const connection = observed.mailboxes?.[mailbox];
    if (!connection?.connected || connection.provider !== "neo_browser" || connection.readOnly !== true) throw new Error(`NEO_MAILBOX_IDENTITY_NOT_VERIFIED: ${mailbox}: ${connection?.error || "unknown NEO page state"}`);
  }
  return observed;
}
