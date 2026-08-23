const NEO_HOST_SUFFIX = "neo.space";

export function isAllowedNeoUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === NEO_HOST_SUFFIX || host.endsWith(`.${NEO_HOST_SUFFIX}`);
  } catch {
    return false;
  }
}

function neoStartStaticContractInspection() {
  const state={status:"running",startedAt:new Date().toISOString(),bundles:[],contracts:[],stores:[],routeResolutions:[],errors:[],credentialsTransferred:false,mailboxDataAccessed:false,mailboxInteractionPerformed:false};window.__georgieNeoStaticContracts=state;
  const forbidden=/token|secret|password|authorization|session|cookie|credential/i;
  const allowedBundle=/\/static\/js\/(?:mail\.[a-f0-9]+|thread-quick-action-list\.[a-f0-9]+(?:\.chunk)?)\.js$/i;
  const safeContract=(raw,bundlePath)=>{try{const absolute=/^(?:https:|wss:)/i.test(raw)?new URL(raw):raw.startsWith("/")?new URL(raw,location.origin):null;if(!absolute||forbidden.test(absolute.pathname)||[...absolute.searchParams.keys()].some(key=>forbidden.test(key)))return null;const protocol=absolute.protocol.toLowerCase();if(!["https:","wss:"].includes(protocol))return null;if(!/mail|message|thread|conversation|inbox|graphql|api/i.test(absolute.pathname+absolute.hostname))return null;return{transport:protocol==="wss:"?"websocket":"https",origin:absolute.origin,path:absolute.pathname,queryKeys:[...absolute.searchParams.keys()].sort().slice(0,30),bundlePath}}catch{return null}};
  const resources=[...new Set([...document.scripts].map(node=>node.src).concat(performance.getEntriesByType("resource").map(entry=>entry.name)).filter(Boolean).filter(raw=>{try{const url=new URL(raw,location.href);return url.origin===location.origin&&url.protocol==="https:"&&allowedBundle.test(url.pathname)}catch{return false}}))].slice(0,10);
  Promise.allSettled(resources.map(async raw=>{const url=new URL(raw,location.href);const response=await fetch(url.href,{method:"GET",credentials:"omit",cache:"no-store",redirect:"error",headers:{Accept:"application/javascript,text/javascript;q=0.9"}});const type=String(response.headers.get("content-type")||"");const length=Number(response.headers.get("content-length")||0);if(!response.ok||(length&&length>8000000)||(!type.includes("javascript")&&!type.includes("text/plain")))throw new Error("bundle fetch rejected");const source=await response.text();if(source.length>8000000)throw new Error("bundle too large");const bytes=new TextEncoder().encode(source);const digest=await crypto.subtle.digest("SHA-256",bytes);const hash=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");state.bundles.push({path:url.pathname,sha256:hash,bytes:bytes.length});const anchors=["api.flockmail.com","bll.flockmail.com","/ae/ws/create"];for(const anchor of anchors){let offset=0,occurrences=0;while((offset=source.indexOf(anchor,offset))>=0&&occurrences<8){const start=Math.max(0,offset-40000),end=Math.min(source.length,offset+anchor.length+40000),context=source.slice(start,end),contextBytes=new TextEncoder().encode(context),contextDigest=await crypto.subtle.digest("SHA-256",contextBytes),contextHash=[...new Uint8Array(contextDigest)].map(value=>value.toString(16).padStart(2,"0")).join("");const routeTemplates=[],routePattern=/["\'](\/[A-Za-z0-9_~.?&=:+{}$()\[\],@!%*-]{2,300})["\']/g;let routeMatch;while((routeMatch=routePattern.exec(context))&&routeTemplates.length<120){const value=routeMatch[1];if(!forbidden.test(value)&&/mail|message|thread|conversation|inbox|search|sync|fetch|list|ae\//i.test(value))routeTemplates.push(value.replace(/([?&][^=]{1,40}=)[^&]{1,120}/g,"$1{value}"))}const methods=[...new Set((context.match(/["\'](?:GET|HEAD|POST|PUT|PATCH|DELETE)["\']/g)||[]).map(value=>value.replace(/["\']/g,"")))];const idFields=[...new Set((context.match(/["\'](?:messageId|message_id|mailId|mail_id|threadId|thread_id|conversationId|conversation_id|uid|messageUid|threadUid)["\']/gi)||[]).map(value=>value.replace(/["\']/g,"")))];const operationSymbols=[...new Set((context.match(/\b(?:get|fetch|list|load|search|sync)(?:Messages?|Mails?|Threads?|Conversations?|Inbox)\b/gi)||[]))].slice(0,40);state.routeResolutions.push({anchor,bundlePath:url.pathname,occurrence:occurrences+1,contextHash,routeTemplates:[...new Set(routeTemplates)].slice(0,80),methods:methods.sort(),immutableIdFields:idFields.sort(),operationSymbols});offset+=anchor.length;occurrences++}}const literals=[];const pattern=/["']((?:https?:\/\/|wss?:\/\/|\/api\/|\/graphql|graphql\/)[^"'\\\s]{1,600})["']/g;let match;while((match=pattern.exec(source))&&literals.length<3000)literals.push(match[1]);for(const rawLiteral of literals){const contract=safeContract(rawLiteral,url.pathname);if(contract)state.contracts.push(contract)}const storePatterns=[["indexeddb",/\bindexedDB\b/g],["localforage",/\blocalforage\b/gi],["dexie",/\bDexie\b/g],["service_worker",/\bserviceWorker\b/g],["websocket",/\bWebSocket\b/g],["graphql",/\bgraphql\b/gi]];for(const [kind,pattern] of storePatterns){if(pattern.test(source))state.stores.push({kind,bundlePath:url.pathname})}})).then(results=>{state.errors=results.filter(item=>item.status==="rejected").map(item=>String(item.reason?.message||item.reason).slice(0,240)).slice(0,20);const key=value=>JSON.stringify(value);state.contracts=[...new Map(state.contracts.map(item=>[key(item),item])).values()].slice(0,200);state.stores=[...new Map(state.stores.map(item=>[key(item),item])).values()].slice(0,50);state.bundles.sort((a,b)=>a.path.localeCompare(b.path));state.routeResolutions=state.routeResolutions.slice(0,24);state.status="completed";state.completedAt=new Date().toISOString()});
  return{started:true,bundleCount:resources.length,methods:["GET"],credentialsMode:"omit",mailboxDataAccessed:false,mailboxInteractionPerformed:false};
}

function neoReadStaticContractInspection(){const state=window.__georgieNeoStaticContracts||{};return{status:state.status||"missing",bundles:Array.isArray(state.bundles)?state.bundles.slice(0,10):[],contracts:Array.isArray(state.contracts)?state.contracts.slice(0,200):[],stores:Array.isArray(state.stores)?state.stores.slice(0,50):[],routeResolutions:Array.isArray(state.routeResolutions)?state.routeResolutions.slice(0,24):[],readSourceProof:(state.routeResolutions||[]).filter(item=>item.methods.includes("GET")&&item.routeTemplates.length&&item.immutableIdFields.length).slice(0,20),errors:Array.isArray(state.errors)?state.errors.slice(0,20):[],methods:["GET"],credentialsMode:"omit",credentialsTransferred:false,mailboxDataAccessed:false,mailboxInteractionPerformed:false,authorizedReadSource:null,authorizationBlocked:true}}

export function buildNeoStaticContractInspectionScript({objectiveId}){const start=neoStartStaticContractInspection.toString(),read=neoReadStaticContractInspection.toString(),objective=String(objectiveId||"").slice(0,160);return `const objectiveId=${JSON.stringify(objective)};const start=${JSON.stringify(start)};const read=${JSON.stringify(read)};const result={provider:'neo_static_bundle_contracts',objectiveId,tabsEnumerated:0,tabsInspected:0,neoTabOrigins:[],inspections:[],credentialsTransferred:false,mailboxDataAccessed:false,mailboxInteractionPerformed:false,authorizedReadSource:null,authorizationBlocked:true};const chrome=Application('Google Chrome');function neo(raw){const match=String(raw||'').match(/^https:\\/\\/([^\\/?#]+)/i);if(!match)return false;const host=match[1].split(':')[0].toLowerCase();return host==='neo.space'||host.endsWith('.neo.space')}if(!chrome.running())throw new Error('NEO_BROWSER_NOT_RUNNING');for(const win of chrome.windows()){for(const tab of win.tabs()){const url=String(tab.url()||'');result.tabsEnumerated++;if(!neo(url))continue;const origin=(url.match(/^https:\\/\\/[^\\/?#]+/i)||[''])[0];result.neoTabOrigins.push(origin);result.tabsInspected++;try{tab.execute({javascript:'JSON.stringify(('+start+')())'});delay(6);const inspected=JSON.parse(tab.execute({javascript:'JSON.stringify(('+read+')())'}));result.inspections.push(Object.assign({origin},inspected))}catch(error){result.inspections.push({origin,status:'failed',error:String(error.message||error).slice(0,500),credentialsTransferred:false,mailboxDataAccessed:false,mailboxInteractionPerformed:false,authorizationBlocked:true})}}}result.neoTabOrigins=[...new Set(result.neoTabOrigins)];JSON.stringify(result);`}

export function validateNeoStaticContractInspection(observed,objectiveId){if(!observed||observed.provider!=="neo_static_bundle_contracts"||observed.objectiveId!==String(objectiveId||"")||observed.credentialsTransferred!==false||observed.mailboxDataAccessed!==false||observed.mailboxInteractionPerformed!==false||observed.authorizationBlocked!==true||observed.authorizedReadSource!==null)throw new Error("NEO_STATIC_CONTRACT_INSPECTION_PROOF_FAILED");if(observed.tabsInspected<1||!Array.isArray(observed.inspections)||!observed.inspections.length)throw new Error("NEO_STATIC_CONTRACT_INSPECTION_TAB_NOT_FOUND");for(const item of observed.inspections)if(item.credentialsTransferred!==false||item.mailboxDataAccessed!==false||item.mailboxInteractionPerformed!==false||item.authorizationBlocked!==true)throw new Error("NEO_STATIC_CONTRACT_INSPECTION_SCOPE_VIOLATION");return observed}

function neoIdentityObserver(requested) {
  const normalized = value => String(value || "").replace(/\u0000/g, "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\u2026/g, "...").replace(/\s*@\s*/g, "@").replace(/\s+/g, " ").trim().toLowerCase();
  const inAccountRail = element => {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const values = element => [element.getAttribute?.("data-email"), element.getAttribute?.("data-account"), element.getAttribute?.("data-address"), element.getAttribute?.("data-testid"), element.getAttribute?.("aria-label"), element.getAttribute?.("title"), element.textContent].filter(Boolean).map(normalized);
  const matchesIdentity = (value, identity) => {
    if (value.includes(identity)) return true;
    const [local, domain] = identity.split("@");
    if (!local || !domain) return false;
    const domainPrefix = domain.slice(0, 4);
    const token = `${local}@${domainPrefix}`;
    const uniqueLocal = requested.filter(candidate => candidate.split("@")[0] === local).length === 1;
    return (value.includes(token) && (value.includes("...") || value.endsWith(token) || value.includes(`${token} `))) || (uniqueLocal && value.includes(`${local}@`) && value.includes("..."));
  };
  const roots = [document], seen = new Set(roots);
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    for (const element of root.querySelectorAll?.("*") || []) {
      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      if (element.tagName === "IFRAME") { try { const frame = element.contentDocument; if (frame && !seen.has(frame)) { seen.add(frame); roots.push(frame); } } catch {} }
    }
  }
  const matches = new Set();
  for (const identity of requested) {
    if (roots.some(root => matchesIdentity(normalized(root.body?.innerText || root.textContent), identity))) matches.add(identity);
  }
  for (const element of roots.flatMap(root => [...(root.querySelectorAll?.("body *, *") || [])])) {
    if (!inAccountRail(element)) continue;
    const hits = requested.filter(identity => values(element).some(value => matchesIdentity(value, identity)));
    if (hits.length === 1) matches.add(hits[0]);
  }
  return [...matches];
}

function neoAccountActivator(identity, requested) {
  const normalized = value => String(value || "").replace(/\u0000/g, "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\u2026/g, "...").replace(/\s*@\s*/g, "@").replace(/\s+/g, " ").trim().toLowerCase();
  const inAccountRail = element => {
    const rect = element?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const values = element => [element.getAttribute?.("data-email"), element.getAttribute?.("data-account"), element.getAttribute?.("data-address"), element.getAttribute?.("data-testid"), element.getAttribute?.("aria-label"), element.getAttribute?.("title"), element.textContent].filter(Boolean).map(normalized);
  const matchesIdentity = (value, requestedIdentity) => {
    if (value.includes(requestedIdentity)) return true;
    const [local, domain] = requestedIdentity.split("@");
    if (!local || !domain) return false;
    const domainPrefix = domain.slice(0, 4);
    const token = `${local}@${domainPrefix}`;
    const uniqueLocal = requested.filter(candidate => candidate.split("@")[0] === local).length === 1;
    return (value.includes(token) && (value.includes("...") || value.endsWith(token) || value.includes(`${token} `))) || (uniqueLocal && value.includes(`${local}@`) && value.includes("..."));
  };
  const roots = [document], seen = new Set(roots);
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    for (const element of root.querySelectorAll?.("*") || []) {
      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      if (element.tagName === "IFRAME") { try { const frame = element.contentDocument; if (frame && !seen.has(frame)) { seen.add(frame); roots.push(frame); } } catch {} }
    }
  }
  const candidates = roots.flatMap(root => [...(root.querySelectorAll?.("body *, *") || [])]).filter(inAccountRail).filter(element => {
    const hits = requested.filter(requestedIdentity => values(element).some(value => matchesIdentity(value, requestedIdentity)));
    return hits.length === 1 && hits[0] === identity;
  }).sort((left, right) => {
    const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
    return (a.left - b.left) || (a.width * a.height - b.width * b.height);
  });
  const control = candidates[0];
  if (!control) return { selected: false, identity, error: "exact mailbox account rail control not found", messageRowsClicked: false, messageOpened: false };
  control.click();
  return { selected: true, identity, accountRailProof: "exact_envelope_bound_account_rail", matchBasis: "unique_requested_identity_token", messageRowsClicked: false, messageOpened: false };
}

function neoStartReadOnlyApiProbe(){
  const state={status:"running",startedAt:new Date().toISOString(),records:[],sources:[],mutations:[],errors:[],credentialsExported:false,requestBodiesCaptured:false};window.__georgieNeoApiProbe=state;
  const originalFetch=window.fetch.bind(window),originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send;
  const forbidden=/token|secret|password|authorization|session|cookie|credential|ssn|ein|routing|accountnumber/i;
  const mailish=/mail|message|thread|conversation|inbox|search|sync|ae\//i;
  const safeUrl=raw=>{try{const url=new URL(String(raw||""),location.href),host=url.hostname.toLowerCase();if(url.protocol!=="https:"||!(host==="neo.space"||host.endsWith(".neo.space")||host==="flockmail.com"||host.endsWith(".flockmail.com")||host==="titan.email"||host.endsWith(".titan.email")))return null;if([...url.searchParams.keys()].some(key=>forbidden.test(key)))return null;return{origin:url.origin,path:url.pathname,queryKeys:[...url.searchParams.keys()].sort().slice(0,30)}}catch{return null}};
  const scalar=(value,max=200000)=>typeof value==="string"||typeof value==="number"?String(value).slice(0,max):"";
  const first=(object,keys)=>{for(const key of keys){const value=scalar(object?.[key]);if(value)return value}return ""};
  const walk=(value,source,depth=0,seen=new WeakSet())=>{if(!value||typeof value!=="object"||depth>9||state.records.length>=300||seen.has(value))return;seen.add(value);if(Array.isArray(value)){for(const item of value.slice(0,500))walk(item,source,depth+1,seen);return}const keys=Object.keys(value).slice(0,180),idKey=keys.find(key=>/^(?:messageId|message_id|mailId|mail_id|uid|messageUid|id)$/i.test(key)&&!forbidden.test(key)),threadKey=keys.find(key=>/^(?:threadId|thread_id|conversationId|conversation_id|threadUid)$/i.test(key)&&!forbidden.test(key)),subject=first(value,["subject","title","mailSubject","messageSubject"]),sender=first(value,["from","sender","fromAddress","senderEmail"]);if(idKey&&(subject||sender)){const messageId=scalar(value[idKey],500),threadId=threadKey?scalar(value[threadKey],500):messageId,content=first(value,["plainText","textBody","body","htmlBody","html","content","messageBody"]);if(/^[A-Za-z0-9][A-Za-z0-9._~:@/-]{4,499}$/.test(messageId))state.records.push({messageId,threadId:/^[A-Za-z0-9][A-Za-z0-9._~:@/-]{4,499}$/.test(threadId)?threadId:messageId,subject:subject.slice(0,1200),timestamp:first(value,["receivedAt","received_at","sentAt","sent_at","date","timestamp","internalDate","createdAt"]).slice(0,120),sender:sender.slice(0,500),content:content.slice(0,200000),bodyComplete:Boolean(content&&content.length<200000),sourceEndpoint:source.path,sourceOrigin:source.origin,sourceMethod:"GET",identifierFields:{message:idKey,thread:threadKey||idKey}})}for(const key of keys){if(forbidden.test(key)||/attachment(?:data|content)|raw/i.test(key))continue;let child;try{child=value[key]}catch{continue}if(child&&typeof child==="object")walk(child,source,depth+1,seen)}};
  const inspect=async(response,method,raw)=>{const source=safeUrl(raw);if(!source)return;if(!state.sources.some(item=>JSON.stringify(item)===JSON.stringify({...source,method})))state.sources.push({...source,method});if(!["GET","HEAD"].includes(method)){if(mailish.test(source.path))state.mutations.push({...source,method});return}const type=String(response.headers?.get?.("content-type")||"");const length=Number(response.headers?.get?.("content-length")||0);if(type.includes("json")&&(!length||length<=3000000)){try{walk(await response.clone().json(),source)}catch(error){state.errors.push(String(error?.message||error).slice(0,200))}}};
  window.fetch=async function(input,init={}){const method=String(init.method||input?.method||"GET").toUpperCase(),raw=typeof input==="string"?input:input?.url,res=await originalFetch(input,init);inspect(res,method,raw);return res};
  XMLHttpRequest.prototype.open=function(method,url){this.__georgieMethod=String(method||"GET").toUpperCase();this.__georgieUrl=String(url||"");return originalOpen.apply(this,arguments)};
  XMLHttpRequest.prototype.send=function(){const xhr=this,method=xhr.__georgieMethod||"GET",source=safeUrl(xhr.__georgieUrl);if(source){if(!state.sources.some(item=>JSON.stringify(item)===JSON.stringify({...source,method})))state.sources.push({...source,method});if(!["GET","HEAD"].includes(method)&&mailish.test(source.path))state.mutations.push({...source,method});xhr.addEventListener("load",()=>{if(!["GET","HEAD"].includes(method))return;const type=String(xhr.getResponseHeader("content-type")||"");if(type.includes("json")&&String(xhr.responseText||"").length<=3000000){try{walk(JSON.parse(xhr.responseText),source)}catch(error){state.errors.push(String(error?.message||error).slice(0,200))}}},{once:true})}return originalSend.apply(this,arguments)};
  Promise.allSettled([navigator.serviceWorker?.getRegistrations?.().then(items=>{state.serviceWorkers=items.map(item=>({scope:new URL(item.scope).pathname,scriptPath:new URL(item.active?.scriptURL||item.installing?.scriptURL||location.origin).pathname})).slice(0,20)}),caches?.keys?.().then(keys=>{state.cacheNames=keys.map(value=>String(value).slice(0,120)).slice(0,50)}),indexedDB?.databases?.().then(items=>{state.indexedDatabases=items.map(item=>({name:String(item.name||"").slice(0,120),version:Number(item.version||0)})).slice(0,50)})]).catch(()=>{});
  return{started:true,credentialsExported:false,requestBodiesCaptured:false,methodsObserved:true};
}

function neoReadApiProbe(){const state=window.__georgieNeoApiProbe||{},unique=new Map();for(const record of state.records||[]){const key=record.messageId+"|"+record.sourceOrigin+"|"+record.sourceEndpoint;if(!unique.has(key))unique.set(key,record)}state.status="completed";return{status:"completed",records:[...unique.values()].slice(0,300),sources:(state.sources||[]).slice(0,100),mutations:(state.mutations||[]).slice(0,50),errors:(state.errors||[]).slice(0,20),serviceWorkers:(state.serviceWorkers||[]).slice(0,20),cacheNames:(state.cacheNames||[]).slice(0,50),indexedDatabases:(state.indexedDatabases||[]).slice(0,50),credentialsExported:false,requestBodiesCaptured:false,sameOriginOnly:false,methods:["GET","HEAD"]}}

function neoMailboxObserver(mailbox, cursors, max, apiProbe) {
  const visible = element => Boolean(element && element.getClientRects().length);
  const text = (value, limit = 6000) => String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
  const selectors = ["[role='row']", "[data-message-id]", "[data-thread-id]", "[data-testid*='message']", "[data-testid*='mail-row']"];
  const rows = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))].filter(visible);
  const messages = [], rejected = [], identifierDiagnostics = [];
  const stableId = value => { const candidate=text(value,500); return /^[A-Za-z0-9][A-Za-z0-9._~-]{5,499}$/.test(candidate) ? candidate : ""; };
  const runtimeStateIds = row => {
    const message=[],thread=[],surfaces=new Set(),seen=new WeakSet();let visited=0;
    const add=(target,value,source)=>{const id=stableId(value);if(id)target.push({id,source});};
    const classify=(key,path,value,source)=>{const joined=(path+"."+key).toLowerCase();if(/(?:^|[._-])(?:message|mail)(?:id|uid)(?:$|[._-])/.test(joined)||/(?:^|[._-])uid(?:$|[._-])/.test(joined))add(message,value,source+":"+path+"."+key);if(/(?:^|[._-])(?:thread|conversation)(?:id|uid)(?:$|[._-])/.test(joined))add(thread,value,source+":"+path+"."+key);};
    const walk=(value,path,source,depth=0)=>{if(value===null||value===undefined||depth>5||visited++>1500)return;if(typeof value!=="object"){const key=path.split(".").pop()||"";classify(key,path.slice(0,-key.length-1),value,source);return}if(seen.has(value))return;seen.add(value);let keys=[];try{keys=Object.keys(value).slice(0,120)}catch{return}for(const key of keys){if(/token|secret|password|cookie|authorization|session/i.test(key))continue;let child;try{child=value[key]}catch{continue}classify(key,path,child,source);if(child&&typeof child==="object")walk(child,path+"."+key,source,depth+1)}};
    const bound=[row,...[...row.querySelectorAll("*")].slice(0,250),row.parentElement,row.parentElement?.parentElement].filter(Boolean);
    for(const node of bound){let names=[];try{names=Object.getOwnPropertyNames(node)}catch{}for(const name of names){if(!/^__(?:reactProps|reactFiber|vueParentComponent|vue__|ngContext)/i.test(name))continue;surfaces.add(name.replace(/[A-Za-z0-9]+$/,"*"));let value;try{value=node[name]}catch{continue}walk(value,name,"row-bound-runtime",0)}if(node.__vueParentComponent){surfaces.add("__vueParentComponent");walk(node.__vueParentComponent,"__vueParentComponent","row-bound-runtime",0)}}
    const unique=list=>[...new Map(list.map(item=>[item.id,item])).values()];return {message:unique(message),thread:unique(thread),surfaces:[...surfaces].sort().slice(0,20),visited};
  };
  const immutableIds = row => {
    const nodes=[row,...row.querySelectorAll("[data-message-id],[data-mail-id],[data-uid],[data-thread-id],[data-conversation-id],[data-id],a[href]")];
    const message=[],thread=[];
    const add=(target,value,source)=>{const id=stableId(value);if(id)target.push({id,source});};
    for(const node of nodes){
      add(message,node.getAttribute("data-message-id"),"data-message-id");
      add(message,node.getAttribute("data-mail-id"),"data-mail-id");
      add(message,node.getAttribute("data-uid"),"data-uid");
      add(thread,node.getAttribute("data-thread-id"),"data-thread-id");
      add(thread,node.getAttribute("data-conversation-id"),"data-conversation-id");
      if(node===row)add(message,node.getAttribute("data-id")||node.id,"row-provider-id");
      const rawHref=node.getAttribute("href");
      if(rawHref){try{const link=new URL(rawHref,location.href);if(link.origin!==location.origin)continue;for(const key of ["messageId","message_id","mailId","mail_id","uid"])add(message,link.searchParams.get(key),"same-origin-link:"+key);for(const key of ["threadId","thread_id","conversationId","conversation_id"])add(thread,link.searchParams.get(key),"same-origin-link:"+key);const match=link.pathname.match(/\/(?:message|mail|thread|conversation)\/([A-Za-z0-9][A-Za-z0-9._~-]{5,499})(?:\/|$)/i);if(match){const target=/thread|conversation/i.test(match[0])?thread:message;add(target,match[1],"same-origin-path");}}catch{}}
    }
    const runtimeA=runtimeStateIds(row),runtimeB=runtimeStateIds(row),stableRuntime=(left,right)=>left.filter(item=>right.some(other=>other.id===item.id));message.push(...stableRuntime(runtimeA.message,runtimeB.message));thread.push(...stableRuntime(runtimeA.thread,runtimeB.thread));const norm=v=>String(v||"").replace(/\s+/g," ").trim().toLowerCase();const rowValue=norm(row.innerText||row.textContent);const apiMatches=(apiProbe?.records||[]).filter(record=>{const subject=norm(record.subject);if(subject.length<3||!rowValue.includes(subject))return false;const parsed=Date.parse(record.timestamp||"");if(!Number.isFinite(parsed))return true;const rowTime=row.querySelector("time")?.getAttribute("datetime")||row.getAttribute("data-received-at")||row.getAttribute("data-date")||"";const rowParsed=Date.parse(rowTime);return !Number.isFinite(rowParsed)||Math.abs(rowParsed-parsed)<86400000});if(apiMatches.length===1){message.push({id:apiMatches[0].messageId,source:"same-origin-api:"+apiMatches[0].sourceEndpoint+":"+apiMatches[0].sourcePath});thread.push({id:apiMatches[0].threadId||apiMatches[0].messageId,source:"same-origin-api-thread:"+apiMatches[0].sourceEndpoint})}
    const unique=list=>[...new Map(list.map(item=>[item.id,item])).values()];
    const messages=unique(message),threads=unique(thread),runtimeStateSurfaces=[...new Set([...runtimeA.surfaces,...runtimeB.surfaces])],apiCorrelationCandidates=apiMatches.length;
    if(messages.length!==1)return {error:messages.length?"ambiguous immutable message id":"missing immutable message id",messageCandidates:messages.length,threadCandidates:threads.length,runtimeStateSurfaces,apiCorrelationCandidates};
    if(threads.length>1)return {error:"ambiguous immutable thread id",messageCandidates:messages.length,threadCandidates:threads.length,runtimeStateSurfaces};
    return {messageId:messages[0].id,messageIdSource:messages[0].source,threadId:threads[0]?.id||messages[0].id,threadIdSource:threads[0]?.source||"message-id-fallback",runtimeStateSurfaces};
  };
  for (const row of rows) {
    const rowText = text(row.innerText || row.textContent, 6000);
    if (rowText.length < 3) continue;
    const ids=immutableIds(row);
    if(ids.error){rejected.push(ids.error);identifierDiagnostics.push({reason:ids.error,messageCandidates:ids.messageCandidates||0,threadCandidates:ids.threadCandidates||0,runtimeStateSurfaces:ids.runtimeStateSurfaces||[],apiCorrelationCandidates:ids.apiCorrelationCandidates||0,apiSources:(apiProbe?.sources||[]).slice(0,10)});continue}
    const {messageId,threadId,messageIdSource,threadIdSource}=ids;
    const time = row.querySelector("time");
    const rawTime = time?.getAttribute("datetime") || row.getAttribute("data-received-at") || row.getAttribute("data-date") || time?.textContent || "";
    const parsed = Date.parse(rawTime);
    if (!Number.isFinite(parsed)) { rejected.push("missing immutable timestamp"); continue; }
    const timestamp = new Date(parsed).toISOString(), cursor = cursors[mailbox];
    if (cursor && (timestamp < cursor.timestamp || (timestamp === cursor.timestamp && messageId <= cursor.messageId))) continue;
    const subjectNode = row.querySelector("[data-subject],[class*='subject'],[aria-label*='Subject']");
    const subject = text(subjectNode?.getAttribute("data-subject") || subjectNode?.textContent || rowText.split(/\n+/)[0], 1200);
    const addresses = [...rowText.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)].map(match => match[0].toLowerCase());
    const unreadSignals = [row.getAttribute("data-unread"), row.getAttribute("aria-label"), row.className, getComputedStyle(row).fontWeight].map(value => String(value || "").toLowerCase());
    const readState = unreadSignals.some(value => value === "true" || /\bunread\b/.test(value) || Number(value) >= 600) ? "unread" : unreadSignals.some(value => value === "false" || /\bread\b/.test(value)) ? "read" : "unknown";
    messages.push({ mailbox, messageId, threadId, messageIdSource, threadIdSource, timestamp, sender: addresses[0] || "", recipients: [], subject, rowExcerpt: rowText, readStateBefore: readState, sourceUrl: text(location.origin + location.pathname, 1000) });
    if (messages.length >= max) break;
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.messageId.localeCompare(b.messageId));
  return { messages: messages.slice(0, max), rejected: [...new Set(rejected)].slice(0, 20), identifierDiagnostics:identifierDiagnostics.slice(0,25), readOnly: true, navigationPerformed: false, messageOpeningPerformed: false, mailboxMutation: false };
}

function neoGuardedMessageOpener(messageId) {
  const text = value => String(value || "").replace(/\u0000/g, "").trim();
  const unsafe = (method, url, body) => {
    const verb = String(method || "GET").toUpperCase();
    const value = `${url || ""} ${body || ""}`.toLowerCase();
    let endpoint; try { endpoint = new URL(String(url || ""), location.href); } catch { return true; }
    return endpoint.origin !== location.origin || !["https:"].includes(endpoint.protocol) || !["GET", "HEAD"].includes(verb) || /(?:token|secret|password|authorization|session)=/i.test(endpoint.search) || /(?:^|[\/_?&=.-])(mark|read|unread|seen|flag|star|archive|delete|trash|spam|move|send|reply|forward|draft|update|mutate|action)(?:$|[\/_?&=.-])/.test(value);
  };
  const candidates = [...document.querySelectorAll("[data-message-id],[data-id],[data-thread-id],[role='row']")].filter(element => {
    const values = [element.getAttribute("data-message-id"), element.getAttribute("data-id"), element.getAttribute("data-thread-id"), element.id].map(text);
    return values.includes(messageId) && element.getClientRects().length;
  }).sort((left, right) => left.getBoundingClientRect().width * left.getBoundingClientRect().height - right.getBoundingClientRect().width * right.getBoundingClientRect().height);
  const row = candidates[0];
  if (!row) return { opened: false, error: "immutable message row not found", guardInstalled: false, blockedMutationCount: 0 };
  const state = { installed: true, messageId, blocked: [], startedAt: new Date().toISOString(), original: {} };
  const block = (channel, detail) => { state.blocked.push({ channel, detail: text(detail).slice(0, 240) }); return true; };
  state.original.fetch = window.fetch;
  window.fetch = function(input, init = {}) { const url = typeof input === "string" ? input : input?.url; const method = init.method || input?.method || "GET"; if (unsafe(method, url, init.body)) { block("fetch", `${method} ${url}`); return Promise.reject(new Error("GEORGIE_READ_ONLY_BLOCK")); } return state.original.fetch.apply(this, arguments); };
  state.original.xhrOpen = XMLHttpRequest.prototype.open; state.original.xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) { this.__georgieMethod = method; this.__georgieUrl = url; return state.original.xhrOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(body) { if (unsafe(this.__georgieMethod, this.__georgieUrl, body)) { block("xhr", `${this.__georgieMethod} ${this.__georgieUrl}`); this.abort(); return; } return state.original.xhrSend.apply(this, arguments); };
  state.original.beacon = navigator.sendBeacon?.bind(navigator); if (navigator.sendBeacon) navigator.sendBeacon = function(url) { block("beacon", url); return false; };
  state.original.wsSend = window.WebSocket?.prototype?.send; if (state.original.wsSend) WebSocket.prototype.send = function(data) { block("websocket", String(data).slice(0, 120)); return; };
  window.__georgieReadGuard = state;
  row.click();
  return { opened: true, guardInstalled: true, method: "guarded_dom_open", blockedMutationCount: state.blocked.length };
}

function neoFullBodyObserver(message, maxBodyBytes) {
  const text = (value, limit = maxBodyBytes) => String(value || "").replace(/\u0000/g, "").trim().slice(0, limit);
  const guard = window.__georgieReadGuard;
  const restore = () => {
    if (!guard?.installed) return;
    if (guard.original.fetch) window.fetch = guard.original.fetch;
    if (guard.original.xhrOpen) XMLHttpRequest.prototype.open = guard.original.xhrOpen;
    if (guard.original.xhrSend) XMLHttpRequest.prototype.send = guard.original.xhrSend;
    if (guard.original.beacon) navigator.sendBeacon = guard.original.beacon;
    if (guard.original.wsSend) WebSocket.prototype.send = guard.original.wsSend;
    delete window.__georgieReadGuard;
  };
  try {
    const candidates = [...document.querySelectorAll("[data-message-id],[data-thread-id],[role='main'],[role='article'],article,[class*='message-body'],[class*='mail-body'],[class*='conversation']")].filter(element => element.getClientRects().length).map(element => ({ element, value: text(element.innerText || element.textContent) })).filter(item => item.value.length > String(message.rowExcerpt || "").length + 40).sort((a, b) => b.value.length - a.value.length);
    const selected = candidates.find(item => [item.element.getAttribute("data-message-id"), item.element.getAttribute("data-thread-id"), item.element.id].map(text).includes(message.messageId));
    const content = text(selected?.value || "");
    const attachmentNodes = selected ? [...selected.element.querySelectorAll("[data-attachment-id],[data-filename],[download],[class*='attachment']")].slice(0, 100) : [];
    const attachments = attachmentNodes.map(node => ({ id: text(node.getAttribute("data-attachment-id") || node.id, 500), name: text(node.getAttribute("data-filename") || node.getAttribute("download") || node.textContent, 500), size: text(node.getAttribute("data-size"), 80) })).filter(item => item.id || item.name);
    const row = [...document.querySelectorAll("[data-message-id],[data-id],[data-thread-id],[role='row']")].find(element => [element.getAttribute("data-message-id"), element.getAttribute("data-id"), element.getAttribute("data-thread-id"), element.id].map(text).includes(message.messageId));
    const unreadSignals = row ? [row.getAttribute("data-unread"), row.getAttribute("aria-label"), row.className, getComputedStyle(row).fontWeight].map(value => String(value || "").toLowerCase()) : [];
    const readStateAfter = unreadSignals.some(value => value === "true" || /\bunread\b/.test(value) || Number(value) >= 600) ? "unread" : unreadSignals.some(value => value === "false" || /\bread\b/.test(value)) ? "read" : "unknown";
    const readStateNeutral = Boolean(guard?.installed && message.readStateBefore !== "unknown" && message.readStateBefore === readStateAfter);
    const bodyComplete = Boolean(content && selected && content.length < maxBodyBytes && content.length > String(message.rowExcerpt || "").length + 40);
    return { ...message, content, attachments, bodyComplete, bodyTruncated: content.length >= maxBodyBytes, retrievalMethod: "guarded_dom_open", readStateAfter, readStateNeutral, transportPolicy: "same_origin_https_get_head_only", blockedMutationCount: guard?.blocked?.length || 0, blockedMutationChannels: [...new Set((guard?.blocked || []).map(item => item.channel))], credentialsTransferred: false, mailboxMutation: false };
  } finally { restore(); }
}

export function buildNeoObservationScript({ mailboxes, cursors, limit }) {
  const requested = [...new Set((mailboxes || []).map(value => String(value).toLowerCase()))];
  const boundedLimit = Math.min(25, Math.max(1, Number(limit) || 25));
  const identityObserver = neoIdentityObserver.toString(), accountActivator = neoAccountActivator.toString(), apiProbeStarter = neoStartReadOnlyApiProbe.toString(), apiProbeReader = neoReadApiProbe.toString(), mailboxObserver = neoMailboxObserver.toString(), guardedOpener = neoGuardedMessageOpener.toString(), fullBodyObserver = neoFullBodyObserver.toString();
  return `const requested=${JSON.stringify(requested)};const cursors=${JSON.stringify(cursors || {})};const max=${boundedLimit};const maxBodyBytes=200000;const identityObserver=${JSON.stringify(identityObserver)};const accountActivator=${JSON.stringify(accountActivator)};const apiProbeStarter=${JSON.stringify(apiProbeStarter)};const apiProbeReader=${JSON.stringify(apiProbeReader)};const mailboxObserver=${JSON.stringify(mailboxObserver)};const guardedOpener=${JSON.stringify(guardedOpener)};const fullBodyObserver=${JSON.stringify(fullBodyObserver)};const result={provider:'neo_browser',mailboxes:{},messages:[],quarantined:[],identityProbeErrors:[],tabsEnumerated:0,tabsInspected:0,neoTabOrigins:[],navigationPerformed:false,accountSelectionPerformed:false,messageOpeningPerformed:false,guardedMessageOpeningPerformed:false,mailboxMutation:false,credentialsTransferred:false,fullBodyGate:true};const chrome=Application('Google Chrome');function clean(v,n=6000){return String(v||'').replace(/\\u0000/g,'').slice(0,n)}function neo(raw){const match=String(raw||'').match(/^https?:\\/\\/([^\\/?#]+)/i);if(!match)return false;const h=match[1].split(':')[0].toLowerCase();return h==='neo.space'||h.endsWith('.neo.space')}if(!chrome.running())throw new Error('NEO_BROWSER_NOT_RUNNING');for(const win of chrome.windows()){for(const tab of win.tabs()){const url=String(tab.url()||'');result.tabsEnumerated++;if(!neo(url))continue;const originMatch=url.match(/^https?:\\/\\/[^\\/?#]+/i);result.neoTabOrigins.push(clean(originMatch?originMatch[0]:'',200));result.tabsInspected++;let identities=[];try{identities=JSON.parse(tab.execute({javascript:'JSON.stringify(('+identityObserver+')('+JSON.stringify(requested)+'))'}))}catch(error){result.identityProbeErrors.push(clean(error.message||error,500));continue}for(const identity of identities){if(result.mailboxes[identity]){result.mailboxes[identity]={connected:false,error:'ambiguous mailbox identity across multiple NEO tabs'};continue}let probeStarted=false;try{tab.execute({javascript:'JSON.stringify(('+apiProbeStarter+')())'});probeStarted=true}catch(error){result.identityProbeErrors.push(clean(error.message||error,500))}let selected;try{selected=JSON.parse(tab.execute({javascript:'JSON.stringify(('+accountActivator+')('+JSON.stringify(identity)+','+JSON.stringify(requested)+'))'}))}catch(error){selected={selected:false,error:clean(error.message||error,500)}}if(!selected.selected||selected.accountRailProof!=='exact_envelope_bound_account_rail'||selected.messageRowsClicked||selected.messageOpened){result.mailboxes[identity]={connected:false,error:selected.error||'safe mailbox account selection failed'};continue}result.accountSelectionPerformed=true;delay(6);let apiProbe={status:'missing',records:[],sources:[],errors:[]};try{if(!probeStarted)throw new Error('transport capture not started');apiProbe=JSON.parse(tab.execute({javascript:'JSON.stringify(('+apiProbeReader+')())'}))}catch(error){apiProbe={status:'failed',records:[],sources:[],errors:[clean(error.message||error,500)]}}let observed;try{observed=JSON.parse(tab.execute({javascript:'JSON.stringify(('+mailboxObserver+')('+JSON.stringify(identity)+','+JSON.stringify(cursors)+','+JSON.stringify(max)+','+JSON.stringify(apiProbe)+'))'}))}catch(error){observed={messages:[],error:clean(error.message||error,500)}}result.mailboxes[identity]={connected:!observed.error,provider:'neo_browser',readOnly:true,identityProof:selected.accountRailProof,identityMatchBasis:selected.matchBasis||null,fullBodyGate:true,error:observed.error||null,rejected:observed.rejected||[],identifierDiagnostics:observed.identifierDiagnostics||[],apiProbe:{status:apiProbe.status,recordCount:(apiProbe.records||[]).length,sources:(apiProbe.sources||[]).slice(0,20),errors:(apiProbe.errors||[]).slice(0,10),sameOriginOnly:apiProbe.sameOriginOnly===true,credentialsExported:false}};for(const metadata of observed.messages||[]){let opened;try{opened=JSON.parse(tab.execute({javascript:'JSON.stringify(('+guardedOpener+')('+JSON.stringify(metadata.messageId)+'))'}))}catch(error){opened={opened:false,error:clean(error.message||error,500)}}if(!opened.opened||!opened.guardInstalled){result.quarantined.push({...metadata,reason:opened.error||'read-state-neutral guarded open failed'});continue}result.guardedMessageOpeningPerformed=true;delay(1);let message;try{message=JSON.parse(tab.execute({javascript:'JSON.stringify(('+fullBodyObserver+')('+JSON.stringify(metadata)+','+maxBodyBytes+'))'}))}catch(error){message={...metadata,bodyComplete:false,readStateNeutral:false,error:clean(error.message||error,500)}}if(!message.bodyComplete||message.bodyTruncated||!message.readStateNeutral||message.mailboxMutation!==false||message.credentialsTransferred!==false){result.quarantined.push({...metadata,reason:message.error||'full body or read-state-neutral proof missing'});continue}result.messages.push(message)}}}}for(const identity of requested)if(!result.mailboxes[identity])result.mailboxes[identity]={connected:false,error:result.identityProbeErrors.length?'NEO browser identity probe failed: '+result.identityProbeErrors[0]:'exact objective-envelope mailbox binding not found in authenticated NEO account rail'};result.messages.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||a.messageId.localeCompare(b.messageId));result.messages=result.messages.slice(0,max);JSON.stringify(result);`;
}

export function validateNeoObservation(observed, mailboxes) {
  if (!observed || observed.provider !== "neo_browser" || observed.navigationPerformed !== false || observed.messageOpeningPerformed !== false || observed.mailboxMutation !== false || observed.credentialsTransferred !== false || observed.fullBodyGate !== true) throw new Error("NEO_READ_ONLY_PROOF_FAILED");
  for (const mailbox of mailboxes) {
    const connection = observed.mailboxes?.[mailbox];
    if (!connection?.connected || connection.provider !== "neo_browser" || connection.readOnly !== true) throw new Error(`NEO_MAILBOX_IDENTITY_NOT_VERIFIED: ${mailbox}: ${connection?.error || "unknown NEO page state"}`);
  }
  for (const message of observed.messages || []) if (message.bodyComplete !== true || message.bodyTruncated === true || message.readStateNeutral !== true || message.mailboxMutation !== false || message.credentialsTransferred !== false || message.retrievalMethod !== "guarded_dom_open") throw new Error(`NEO_FULL_BODY_PROOF_FAILED: ${message.messageId || "unknown"}`);
  return observed;
}
