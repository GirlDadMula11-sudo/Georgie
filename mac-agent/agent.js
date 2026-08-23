import "dotenv/config";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import crypto from "crypto";
import { buildNeoObservationScript, validateNeoObservation, buildNeoStaticContractInspectionScript, validateNeoStaticContractInspection } from "./neo-mail-reader.js";

const execFileAsync = promisify(execFile);
const BASE = String(process.env.GEORGIE_SERVER_URL || "").replace(/\/$/, "");
const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || "primary-mac";
const AGENT_VERSION = "2.2.17";
const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;
const INTERVAL = Math.max(750, Number(process.env.GEORGIE_MAC_POLL_MS || 1000));
const MAX_BACKOFF = Math.max(INTERVAL, Number(process.env.GEORGIE_MAC_MAX_BACKOFF_MS || 30000));

if (!BASE || !TOKEN) throw new Error("GEORGIE_SERVER_URL and GEORGIE_MAC_AGENT_TOKEN are required");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeErrorDetail(error) {
  const value = error instanceof Error ? error : new Error(String(error));
  const cause = value.cause && typeof value.cause === "object" ? value.cause : {};
  return {
    message: String(value.message || "Unknown error").slice(0, 500),
    code: cause.code ? String(cause.code).slice(0, 100) : null,
    syscall: cause.syscall ? String(cause.syscall).slice(0, 100) : null,
    hostname: cause.hostname ? String(cause.hostname).slice(0, 255) : null
  };
}

const SAFE_APPS = ["Safari","Google Chrome","Notes","Mail","Finder","Calendar","Messages","Preview","System Settings","Microsoft Excel","Microsoft Word","Adobe Acrobat Reader"];
const SAFE_KEYS = new Set(["return","tab","escape","space","delete","up arrow","down arrow","left arrow","right arrow"]);
function canonicalApp(value) {
  const requested = String(value || "").trim().toLowerCase();
  const app = SAFE_APPS.find(name => name.toLowerCase() === requested);
  if (!app) throw new Error("Application is not allowlisted");
  return app;
}

async function api(route, options = {}) {
  const response = await fetch(`${BASE}${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Georgie server ${response.status}: ${await response.text()}`);
  return response.json();
}

async function runAppleScript(script) {
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 30000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function runJxa(script) {
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function approvedBrowserDomains() {
  const defaults = ["sierramarketinginc.com","smartlead.ai","render.com","vercel.com","supabase.com","github.com","neo.space"];
  const configured = String(process.env.GEORGIE_MAC_APPROVED_BROWSER_DOMAINS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...defaults, ...configured])];
}

async function inspectBrowserTabs({ includeContent = true } = {}) {
  const domains = approvedBrowserDomains();
  const script = `
const includeContent = ${includeContent ? "true" : "false"};
const approved = ${JSON.stringify(domains)};
const maxPerTab = 12000;
const result = { observedAt: new Date().toISOString(), tabs: [], browserErrors: [] };
function clean(value, max) { return String(value || '').replace(/\\u0000/g, '').slice(0, max); }
function approvedUrl(raw) { const match = String(raw || '').match(/^https?:\\/\\/([^\\/?#]+)/i); if (!match) return false; const host = match[1].split(':')[0].toLowerCase(); return approved.some(d => host === d || host.endsWith('.' + d)); }
function safeUrl(raw) { return clean(String(raw || '').replace(/([?&#](?:api[_-]?key|token|secret|password|code|session|auth)=)[^&#]*/ig, '$1[REDACTED]').replace(/#.*$/, ''), 4000); }
function redact(value) { return clean(String(value || '').replace(/(?:api[_ -]?key|password|secret|access[_ -]?token|refresh[_ -]?token|authorization)\\s*[:=]?\\s*[^\\n]{1,240}/ig, '[REDACTED SENSITIVE VALUE]').replace(/\\b(?:sk|sb_secret|rnd|ghp|github_pat)_[A-Za-z0-9_-]{8,}\\b/g, '[REDACTED CREDENTIAL]'), maxPerTab); }
function safeTextScript() { return "(() => { const c = document.body ? document.body.innerText : ''; return String(c || '').slice(0, " + maxPerTab + "); })()"; }
try {
  const safari = Application('Safari');
  if (safari.running()) safari.windows().forEach((win, wi) => {
    const activeUrl = safeUrl(win.currentTab().url());
    win.tabs().forEach((tab, ti) => {
      const rawUrl = clean(tab.url(), 4000), url = safeUrl(rawUrl), allowed = approvedUrl(rawUrl);
      const item = { browser: 'Safari', window: wi + 1, tab: ti + 1, active: url === activeUrl, title: clean(tab.name(), 1000), url, contentApproved: allowed, content: null, contentError: null };
      if (includeContent && allowed) { try { item.content = redact(tab.doJavaScript(safeTextScript())); } catch (e) { item.contentError = clean(e.message || e, 1000); } }
      result.tabs.push(item);
    });
  });
} catch (e) { result.browserErrors.push({ browser: 'Safari', error: clean(e.message || e, 1000) }); }
try {
  const chrome = Application('Google Chrome');
  if (chrome.running()) chrome.windows().forEach((win, wi) => {
    const active = Number(win.activeTabIndex());
    win.tabs().forEach((tab, ti) => {
      const rawUrl = clean(tab.url(), 4000), url = safeUrl(rawUrl), allowed = approvedUrl(rawUrl);
      const item = { browser: 'Google Chrome', window: wi + 1, tab: ti + 1, active: (ti + 1) === active, title: clean(tab.title(), 1000), url, contentApproved: allowed, content: null, contentError: null };
      if (includeContent && allowed) { try { item.content = redact(tab.execute({ javascript: safeTextScript() })); } catch (e) { item.contentError = clean(e.message || e, 1000); } }
      result.tabs.push(item);
    });
  });
} catch (e) { result.browserErrors.push({ browser: 'Google Chrome', error: clean(e.message || e, 1000) }); }
result.tabCount = result.tabs.length;
result.contentInspectedCount = result.tabs.filter(t => t.content !== null).length;
result.metadataOnlyCount = result.tabs.filter(t => t.content === null).length;
JSON.stringify(result);
`;
  const parsed = JSON.parse(await runJxa(script) || "{}");
  return { ...parsed, approvedDomains: domains, credentialRedactionApplied: true, formValuesCaptured: false };
}

async function waitForAppProcess(app, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const running = await runAppleScript(`tell application "System Events" to exists process ${JSON.stringify(app)}`);
      if (running === "true") return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

async function openAndActivateApp(app) {
  await execFileAsync("open", ["-a", app], { timeout: 15000 });
  try {
    await runAppleScript(`tell application ${JSON.stringify(app)} to activate`);
  } catch {}
  const running = await waitForAppProcess(app);
  if (!running) throw new Error(`${app} did not report as running after launch`);
  return { opened: app, verifiedRunning: true };
}

function assertUserFile(target) {
  const resolved = path.resolve(String(target || ""));
  const allowedRoots = ["Desktop","Documents","Downloads"].map(name => path.join(os.homedir(), name));
  if (!allowedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep))) throw new Error("Path is outside allowed user folders");
  return resolved;
}

const DEV_EXCLUDED_SEGMENTS = new Set([".git", "node_modules", ".env", ".ssh", ".aws", ".config"]);
function developerRoots() {
  return String(process.env.GEORGIE_DEV_WORKSPACE_ROOTS || "")
    .split(",").map(value => path.resolve(value.trim())).filter(Boolean);
}
function assertDeveloperRoot(target) {
  const roots = developerRoots();
  if (!roots.length) throw new Error("Developer workspace is not configured on this Mac");
  const resolved = target ? path.resolve(String(target)) : roots[0];
  if (!roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) throw new Error("Repository is outside configured developer workspaces");
  return resolved;
}
function assertDeveloperFile(root, target) {
  const repo = assertDeveloperRoot(root);
  const resolved = path.resolve(repo, String(target || ""));
  if (!(resolved === repo || resolved.startsWith(repo + path.sep))) throw new Error("File is outside the repository");
  const relative = path.relative(repo, resolved);
  if (relative.split(path.sep).some(segment => DEV_EXCLUDED_SEGMENTS.has(segment) || segment.startsWith(".env"))) throw new Error("Secret and generated paths are not available to the developer workspace");
  return { repo, resolved, relative };
}
async function runDeveloper(command, args, options = {}) {
  const env = { ...process.env, PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(":") };
  const { stdout = "", stderr = "" } = await execFileAsync(command, args, { timeout: options.timeout || 30000, maxBuffer: 4 * 1024 * 1024, cwd: options.cwd, env });
  return { stdout: String(stdout).slice(0, 250000), stderr: String(stderr).slice(0, 50000) };
}
function patchPaths(patchText) {
  const paths = [];
  for (const match of String(patchText || "").matchAll(/^\+\+\+\s+(?:b\/)?(.+)$/gm)) {
    const candidate = match[1].trim();
    if (candidate !== "/dev/null") paths.push(candidate);
  }
  return paths;
}
function validateDeveloperPatch(repo, patchText) {
  const patch = String(patchText || "");
  if (!patch || patch.length > 100000) throw new Error("Patch must contain between 1 and 100,000 characters");
  const paths = patchPaths(patch);
  if (!paths.length) throw new Error("Patch does not contain a target file");
  for (const target of paths) assertDeveloperFile(repo, target);
  return patch;
}

async function semanticDomStep(projectId,step){
  const operation=JSON.stringify(step),prefix=JSON.stringify(`https://supabase.com/dashboard/project/${projectId}`);
  const pageScript=`(() => { const step=${operation}; const norm=v=>String(v||'').replace(/\\s+/g,' ').trim().toLowerCase(); const visible=e=>!!(e&&e.getClientRects().length); const all=s=>[...document.querySelectorAll(s)].filter(visible); const body=norm(document.body?.innerText); if(step.action==='assert_text'){if(!body.includes(norm(step.text)))throw new Error('Expected text is not present');return {asserted:step.text};} const candidates=all('button,a,label,[role="button"],[role="switch"],[role="radio"],input,select').filter(e=>norm(e.innerText||e.getAttribute('aria-label')||e.name||'').includes(norm(step.text))); if(step.action==='click_text'){if(candidates.length!==1)throw new Error('Semantic target count '+candidates.length);candidates[0].click();return {clicked:step.text};} if(step.action==='set_control'||step.action==='assert_control'){let root=candidates[0];if(candidates.length!==1)throw new Error('Semantic control count '+candidates.length);let control=root.matches('input,select,[role="switch"],[role="radio"]')?root:root.querySelector('input,select,[role="switch"],[role="radio"]')||root.parentElement?.querySelector('input,select,[role="switch"],[role="radio"]');if(!control)throw new Error('Semantic control was not found');if(step.value===true){const checked=control.checked===true||control.getAttribute('aria-checked')==='true';if(step.action==='assert_control'){if(!checked)throw new Error('Approved control value did not persist');return {setting:step.setting,value:true,verified:true};}if(!checked)control.click();return {setting:step.setting,value:true,changed:!checked};}if(step.value==='recommended_percentage'){const scope=root.closest('section,form,div')||document;const options=[...scope.querySelectorAll('option,[role="option"],button,label,[role="radio"]')].filter(visible).filter(e=>/recommended|percentage|%/.test(norm(e.innerText||e.textContent)));if(step.action==='assert_control'){const selected=options.filter(e=>e.selected||e.checked||e.getAttribute('aria-checked')==='true'||e.getAttribute('aria-selected')==='true');if(selected.length!==1)throw new Error('Recommended percentage value did not persist');return {setting:step.setting,value:norm(selected[0].innerText||selected[0].textContent),verified:true};}if(options.length!==1)throw new Error('Recommended percentage option count '+options.length);const option=options[0];if(option.tagName==='OPTION'){option.parentElement.value=option.value;option.parentElement.dispatchEvent(new Event('change',{bubbles:true}));}else option.click();return {setting:step.setting,value:norm(option.innerText||option.textContent)};}throw new Error('Unsupported semantic value');}throw new Error('Unsupported semantic action'); })()`;
  const script=`const prefix=${prefix};const js=${JSON.stringify(pageScript)};let out=null;const chrome=Application('Google Chrome');if(chrome.running()&&chrome.windows().length){const tab=chrome.windows[0].activeTab();if(String(tab.url()).startsWith(prefix))out=tab.execute({javascript:js});}if(out===null){const safari=Application('Safari');if(safari.running()&&safari.windows().length){const tab=safari.windows[0].currentTab();if(String(tab.url()).startsWith(prefix))out=tab.doJavaScript(js);}}if(out===null)throw new Error('No active approved Supabase project tab');JSON.stringify(out);`;
  return JSON.parse(await runJxa(script)||"{}");
}

async function executeBrowserWorkflow(job){
  const workflow=job.args?.workflow||{},projectId=String(workflow.projectId||"");if(workflow.provider!=="supabase"||!/^[a-z0-9]{20}$/.test(projectId))throw new Error("Invalid browser workflow scope");
  const steps=Array.isArray(workflow.steps)?workflow.steps:[];let next=Math.max(0,Number(job.workflowCheckpoint?.nextStep||0));const receipts=Array.isArray(job.workflowCheckpoint?.receipts)?[...job.workflowCheckpoint.receipts]:[];
  for(;next<steps.length;next++){const step=steps[next],startedAt=new Date().toISOString();let result;
    if(step.action==="open_url"){const url=new URL(String(step.url));if(!url.toString().startsWith(`https://supabase.com/dashboard/project/${projectId}`))throw new Error("Workflow URL escaped approved project");await execFileAsync("open",[url.toString()]);result={opened:url.toString()};}
    else if(step.action==="wait"){await new Promise(resolve=>setTimeout(resolve,Math.max(100,Math.min(10000,Number(step.ms)||500))));result={waitedMs:Number(step.ms)||500};}
    else if(step.action==="inspect")result=await inspectBrowserTabs({includeContent:true});
    else if(step.action==="screenshot"){const target=path.join(os.tmpdir(),`georgie-workflow-${job.id}-${next}.png`);await execFileAsync("screencapture",["-x",target],{timeout:15000});const bytes=await fs.readFile(target);await fs.unlink(target).catch(()=>{});result={mimeType:"image/png",base64:bytes.toString("base64").slice(0,8_000_000)};}
    else result=await semanticDomStep(projectId,step);
    const receipt={stepId:step.id,index:next,startedAt,completedAt:new Date().toISOString(),result};receipts.push(receipt);await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs/${encodeURIComponent(job.id)}/checkpoint`,{method:"POST",body:JSON.stringify({nextStep:next+1,stepId:step.id,receipt})});
  }
  return{workflowCompleted:true,projectId,allowedSettings:workflow.allowedSettings,stepCount:steps.length,resumedFrom:Number(job.workflowCheckpoint?.nextStep||0),receipts};
}

const MAILBOX_BRIDGE_PATH = path.join(os.homedir(), "Library", "Application Support", "Georgie", "mailbox-evidence-cursors.json");
const ALLOWED_BRIDGE_MAILBOX_DOMAIN = "sierramarketinginc.com";
const allowedBridgeMailbox = value => String(value||"").toLowerCase().endsWith(`@${ALLOWED_BRIDGE_MAILBOX_DOMAIN}`);
const sha256 = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
function redactMailboxBody(value="",limit=200000) { return String(value).replace(/\b\d{3}-?\d{2}-?\d{4}\b/g,"[REDACTED_SSN]").replace(/\b\d{2}-?\d{7}\b/g,"[REDACTED_EIN]").replace(/\b(?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])[\/-](?:19|20)\d{2}\b/g,"[REDACTED_DOB]").replace(/\b(?:account|acct|routing)\s*(?:number|no\.?|#)?\s*[:=-]?\s*\d{4,17}\b/ig,"[REDACTED_FINANCIAL_NUMBER]").replace(/\b\d{8,17}\b/g,"[REDACTED_FINANCIAL_NUMBER]").replace(/(?:password|passcode|api[_ -]?key|secret|access[_ -]?token|refresh[_ -]?token|authorization|cookie|session)\s*[:=]?\s*\S+/ig,"[REDACTED_CREDENTIAL]").slice(0,limit); }
function redactMailboxText(value="") { return redactMailboxBody(value,1200); }
function domains(values=[]){return [...new Set(values.map(value=>String(value).match(/@([^>\s,;]+)/)?.[1]?.toLowerCase()).filter(Boolean))].slice(0,20)}
async function readBridgeState(){try{return JSON.parse(await fs.readFile(MAILBOX_BRIDGE_PATH,"utf8"))}catch(error){if(error?.code!=="ENOENT")throw error;return{version:1,objectives:{}}}}
async function writeBridgeState(state){await fs.mkdir(path.dirname(MAILBOX_BRIDGE_PATH),{recursive:true,mode:0o700});const temporary=`${MAILBOX_BRIDGE_PATH}.${process.pid}.tmp`;await fs.writeFile(temporary,JSON.stringify(state),{mode:0o600});await fs.rename(temporary,MAILBOX_BRIDGE_PATH)}
function mailboxOutcome(text=""){const value=String(text),amount=value.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1]||null;return{decision:/\bapproved?|offer(?:ed)?\b/i.test(value)?"approval_or_offer":/\bdeclin(?:e|ed)|denied\b/i.test(value)?"decline":/\bfunded|funding complete\b/i.test(value)?"funding":"unknown",amount:amount?Number(amount.replace(/,/g,"")):null,terms:null,stipulations:/\bstip(?:ulation)?s?|conditions?\b/i.test(value)?["source correspondence contains stipulation language"]:[]}}
async function localNeoStaticContractInvestigation(job){
  const args=job.args||{},objectiveId=String(args.objectiveId||"").slice(0,160);
  if(!objectiveId||args.authority!=="read_only"||args.operation!=="static_contract_inspection")throw new Error("NEO_STATIC_CONTRACT_AUTHORIZATION_FAILED");
  const observed=validateNeoStaticContractInspection(JSON.parse(await runJxa(buildNeoStaticContractInspectionScript({objectiveId}))||"{}"),objectiveId);
  return{neoStaticContractInspection:observed,objectiveId,targetDevice:"primary-mac",authority:"read_only",credentialsTransferred:false,mailboxDataAccessed:false,mailboxInteractionPerformed:false,authorizedReadSource:null,authorizationBlocked:true};
}

async function localMailboxBatch(job){
  const args=job.args||{},objectiveId=String(args.objectiveId||"").slice(0,160),authority=String(args.authority||"");
  if(!objectiveId||authority!=="read_only"||args.operation!=="connection_verify_and_backfill")throw new Error("MAILBOX_BRIDGE_AUTHORIZATION_FAILED");
  const mailboxes=(args.mailboxes||[]).map(v=>String(v).toLowerCase());if(!mailboxes.length||mailboxes.some(v=>!allowedBridgeMailbox(v)))throw new Error("MAILBOX_BRIDGE_SCOPE_INVALID");
  const limit=Math.min(25,Math.max(1,Number(args.batchLimit||25))),state=await readBridgeState(),objective=state.objectives[objectiveId]||{cursors:{},records:{}};
  const cursor=objective.cursors||{},script=buildNeoObservationScript({mailboxes,cursors:cursor,limit});
  const observed=validateNeoObservation(JSON.parse(await runJxa(script)||"{}"),mailboxes),batchId=`mbxbatch_${sha256(`${objectiveId}:${job.id}:${Date.now()}`).slice(0,32)}`,packets=[],quarantined=[...(observed.quarantined||[])];
  for(const message of observed.messages||[]){
    if(message.bodyComplete!==true||message.bodyTruncated===true||message.readStateNeutral!==true||message.mailboxMutation!==false||message.credentialsTransferred!==false){quarantined.push({mailbox:message.mailbox,messageId:message.messageId,reason:"full-body read-state-neutral certification gate failed"});continue}
    if((message.attachments||[]).length){quarantined.push({mailbox:message.mailbox,messageId:message.messageId,reason:"attachment content hashes unavailable; message withheld from certification"});continue}
    const redactedBody=redactMailboxBody(message.content||""),combined=`${message.subject||""}\n${redactedBody}`,subject=redactMailboxText(String(message.subject||"").replace(/^(?:re|fw|fwd):\s*/ig,"").replace(/\s+/g," ")),bodyHash=sha256(redactedBody);
    const packet={objectiveId,batchId,packetId:`mbxpkt_${sha256(`${objectiveId}:${message.mailbox}:${message.messageId}`).slice(0,32)}`,mailbox:message.mailbox,messageId:message.messageId,threadId:message.threadId||message.messageId,timestamp:message.timestamp,senderDomains:domains([message.sender]),recipientDomains:domains(message.recipients),normalizedSubject:subject,dealCandidates:[],lenderCandidates:[],evidenceClass:"lender_communication",outcome:mailboxOutcome(combined),attachmentHashes:[],sourceLocator:`local-neo://${message.mailbox}/message/${encodeURIComponent(message.messageId)}`,confidence:0.65,conflicts:[],excerpt:redactMailboxText(redactedBody),bodyHash,bodyComplete:true,retrievalMethod:message.retrievalMethod,readStateProof:{before:message.readStateBefore,after:message.readStateAfter,neutral:true,transportPolicy:message.transportPolicy,blockedMutationCount:Number(message.blockedMutationCount||0)},credentialsTransferred:false,mailboxMutation:false,observedAt:new Date().toISOString()};
    const key=`${packet.mailbox}:${packet.messageId}`,prior=objective.records[key],canonicalHash=sha256({mailbox:packet.mailbox,messageId:packet.messageId,threadId:packet.threadId,timestamp:packet.timestamp,bodyHash});if(prior&&prior.canonicalHash!==canonicalHash)packet.conflicts.push("canonical message amendment observed");objective.records[key]={packetId:packet.packetId,canonicalHash,redactedBody,bodyHash,retrievalMethod:packet.retrievalMethod,readStateProof:packet.readStateProof,amendments:prior&&prior.canonicalHash!==canonicalHash?[...(prior.amendments||[]),{at:new Date().toISOString(),priorHash:prior.canonicalHash}].slice(-50):(prior?.amendments||[])};packets.push(packet);objective.cursors[packet.mailbox]={timestamp:packet.timestamp,messageId:packet.messageId};
  }
  state.objectives[objectiveId]=objective;await writeBridgeState(state);
  return{mailboxEvidenceBatch:{objectiveId,batchId,targetDevice:"primary-mac",authority:"read_only",fullBodyGate:true,mailboxes,cursor:objective.cursors,packets,quarantined:quarantined.slice(0,100)},connection:observed.mailboxes||{},localCursorPath:"Application Support/Georgie/mailbox-evidence-cursors.json",fullBodyGate:true,credentialsTransferred:false,mailboxMutation:false};
}

async function execute(job) {
  const a = job.args || {};
  switch (job.action) {
    case "system.info":
      return { hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(), uptime: os.uptime() };
    case "app.open": {
      const app = canonicalApp(a.app);
      return openAndActivateApp(app);
    }
    case "app.activate": {
      const app = canonicalApp(a.app);
      await runAppleScript(`tell application ${JSON.stringify(app)} to activate`);
      return { activated: app };
    }
    case "url.open": {
      const url = new URL(String(a.url));
      if (!["https:","http:"].includes(url.protocol)) throw new Error("Only web URLs are allowed");
      await execFileAsync("open", [url.toString()]);
      return { opened: url.toString() };
    }
    case "clipboard.read":
      return { text: await runAppleScript("the clipboard as text") };
    case "clipboard.write":
      await runAppleScript(`set the clipboard to ${JSON.stringify(String(a.text || ""))}`);
      return { written: true };
    case "notification.show":
      await runAppleScript(`display notification ${JSON.stringify(String(a.body || ""))} with title ${JSON.stringify(String(a.title || "Georgie"))}`);
      return { shown: true };
    case "file.read": {
      const target = assertUserFile(a.path);
      const text = await fs.readFile(target, "utf8");
      return { path: target, text: text.slice(0, 100000) };
    }
    case "developer.repo_inspect": {
      const repo = assertDeveloperRoot(a.repo);
      const [status, branch, commits, files] = await Promise.all([
        runDeveloper("git", ["-C", repo, "status", "--short"]),
        runDeveloper("git", ["-C", repo, "branch", "--show-current"]),
        runDeveloper("git", ["-C", repo, "log", "-5", "--pretty=format:%h %s"]),
        runDeveloper("git", ["-C", repo, "ls-files"])
      ]);
      return { repo, branch: branch.stdout.trim(), status: status.stdout, recentCommits: commits.stdout, trackedFiles: files.stdout.split("\n").filter(Boolean).slice(0, 5000), readOnly: true };
    }
    case "developer.search": {
      const repo = assertDeveloperRoot(a.repo);
      const query = String(a.query || "").slice(0, 500);
      if (!query) throw new Error("Search query is required");
      let result, engine = "ripgrep";
      try { result = await runDeveloper("rg", ["-n", "--hidden", "--glob", "!.git/**", "--glob", "!node_modules/**", "--glob", "!.env*", "--", query, repo]); }
      catch (error) {
        if (error?.code === 1) result = { stdout: "", stderr: "" };
        else if (error?.code === "ENOENT") {
          engine = "git-grep";
          try { result = await runDeveloper("git", ["-C", repo, "grep", "-n", "-E", "--", query]); }
          catch (fallbackError) { if (fallbackError?.code === 1) result = { stdout: "", stderr: "" }; else throw fallbackError; }
        } else throw error;
      }
      return { repo, query, engine, matches: result.stdout.slice(0, 200000), readOnly: true };
    }
    case "developer.file_read": {
      const target = assertDeveloperFile(a.repo, a.path);
      const text = await fs.readFile(target.resolved, "utf8");
      return { repo: target.repo, path: target.relative, text: text.slice(0, 200000), truncated: text.length > 200000, readOnly: true };
    }
    case "developer.run_checks": {
      const repo = assertDeveloperRoot(a.repo);
      const script = String(a.script || "check");
      if (!["check", "test", "benchmark"].includes(script)) throw new Error("Developer check script is not allowlisted");
      const result = await runDeveloper("npm", ["run", script, "--if-present"], { cwd: repo, timeout: 120000 });
      return { repo, script, ...result, verified: true };
    }
    case "developer.update_restart_from_main": {
      const repo = assertDeveloperRoot(a.repo);
      if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
      const before = await runDeveloper("git", ["-C", repo, "rev-parse", "HEAD"]);
      const status = await runDeveloper("git", ["-C", repo, "status", "--porcelain"]);
      if (status.stdout.trim()) throw new Error("PRIMARY_MAC_REPO_DIRTY");
      await runDeveloper("git", ["-C", repo, "fetch", "origin", "main"], { timeout: 120000 });
      await runDeveloper("git", ["-C", repo, "merge", "--ff-only", "origin/main"], { timeout: 120000 });
      const after = await runDeveloper("git", ["-C", repo, "rev-parse", "HEAD"]);
      const install = await runDeveloper("/bin/bash", [path.join(repo, "mac-agent/install.sh")], { cwd: repo, timeout: 120000 });
      return { repo, before: before.stdout.trim(), after: after.stdout.trim(), fastForwardOnly: true, install, restartRequested: true };
    }
    case "developer.install_neo_preload": {
      const repo = assertDeveloperRoot(a.repo);
      if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
      const extension = path.join(repo, "mac-agent/neo-preload-extension");
      const manifestText = await fs.readFile(path.join(extension, "manifest.json"), "utf8");
      const manifest = JSON.parse(manifestText);
      if (manifest.manifest_version !== 3 || manifest.content_scripts?.[0]?.run_at !== "document_start" || manifest.content_scripts?.[0]?.world !== "MAIN" || JSON.stringify(manifest.content_scripts?.[0]?.matches) !== JSON.stringify(["https://app.neo.space/*"])) throw new Error("NEO_PRELOAD_MANIFEST_SCOPE_REJECTED");
      const preloadText = await fs.readFile(path.join(extension, "preload.js"), "utf8");
      if (/document\.cookie|localStorage|getItem\(|sessionStorage|chrome\.storage|request\.headers|request\.body|init\.body/i.test(preloadText)) throw new Error("NEO_PRELOAD_PRIVACY_GUARD_REJECTED");
      const manifestHash = crypto.createHash("sha256").update(manifestText).digest("hex");
      const preloadHash = crypto.createHash("sha256").update(preloadText).digest("hex");
      await runDeveloper("/usr/bin/osascript", ["-e", "tell application \"Google Chrome\" to quit"], { timeout: 15000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 3000));
      await runDeveloper("/usr/bin/open", ["-a", "Google Chrome", "--args", `--load-extension=${extension}`], { timeout: 15000 });
      return { repo, extension, manifestVersion: manifest.version, manifestHash, preloadHash, runAt: "document_start", world: "MAIN", matches: manifest.content_scripts[0].matches, chromeRelaunched: true, credentialsTransferred: false };
    }
    case "developer.apply_patch": {
      const repo = assertDeveloperRoot(a.repo);
      const patch = validateDeveloperPatch(repo, a.patch);
      const target = path.join(os.tmpdir(), `georgie-patch-${Date.now()}.diff`);
      await fs.writeFile(target, patch, { mode: 0o600 });
      let applied = false;
      try {
        await runDeveloper("git", ["-C", repo, "apply", "--check", target]);
        await runDeveloper("git", ["-C", repo, "apply", target]);
        applied = true;
        const [check, stat, status] = await Promise.all([
          runDeveloper("git", ["-C", repo, "diff", "--check"]),
          runDeveloper("git", ["-C", repo, "diff", "--stat"]),
          runDeveloper("git", ["-C", repo, "status", "--short"])
        ]);
        return { repo, applied: true, patchHash: String(a.patchHash || ""), diffCheck: check.stdout || check.stderr || "clean", diffStat: stat.stdout, status: status.stdout, committed: false, pushed: false };
      } catch (error) {
        if (applied) await runDeveloper("git", ["-C", repo, "apply", "--reverse", target]).catch(() => {});
        throw error;
      } finally {
        await fs.unlink(target).catch(() => {});
      }
    }
    case "screen.capture": {
      const target = path.join(os.tmpdir(), `georgie-screen-${Date.now()}.png`);
      await execFileAsync("screencapture", ["-x", target], { timeout: 15000 });
      const bytes = await fs.readFile(target);
      await fs.unlink(target).catch(() => {});
      return { mimeType: "image/png", base64: bytes.toString("base64").slice(0, 8_000_000) };
    }
    case "browser.inspect_tabs":
      return inspectBrowserTabs({ includeContent: a.includeContent !== false });
    case "browser.workflow":
      return executeBrowserWorkflow(job);
    case "mailbox.neo_static_contract_inspect":
      return localNeoStaticContractInvestigation(job);
    case "mailbox.read_only_backfill":
      return localMailboxBatch(job);
    case "ui.click": {
      const x = Math.max(0, Math.min(10000, Math.round(Number(a.x) || 0)));
      const y = Math.max(0, Math.min(10000, Math.round(Number(a.y) || 0)));
      await runAppleScript(`tell application "System Events" to click at {${x}, ${y}}`);
      return { clicked: { x, y }, verifiedBy: "system_events_accepted" };
    }
    case "ui.type_text": {
      const text = String(a.text || "").slice(0, 10000);
      await runAppleScript(`tell application "System Events" to keystroke ${JSON.stringify(text)}`);
      return { typed: text.length };
    }
    case "ui.key": {
      const key = String(a.key || "").toLowerCase();
      if (!SAFE_KEYS.has(key)) throw new Error("Key is not allowlisted");
      const modifiers = Array.isArray(a.modifiers) ? a.modifiers.filter(m => ["command down","option down","control down","shift down"].includes(m)).slice(0, 3) : [];
      const using = modifiers.length ? ` using {${modifiers.join(", ")}}` : "";
      const code = key === "return" ? 36 : key === "tab" ? 48 : key === "escape" ? 53 : key === "space" ? 49 : key === "delete" ? 51 : key === "up arrow" ? 126 : key === "down arrow" ? 125 : key === "left arrow" ? 123 : 124;
      await runAppleScript(`tell application "System Events" to key code ${code}${using}`);
      return { key, modifiers };
    }
    default:
      throw new Error(`Unsupported Mac action: ${job.action}`);
  }
}

async function cycle() {
  try {
    await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/heartbeat`, { method: "POST", body: JSON.stringify({ hostname: os.hostname(), platform: os.platform(), arch: os.arch(), agentVersion: AGENT_VERSION }) });
    const payload = await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs?limit=5`);
    for (const job of payload.jobs || []) {
      try {
        const result = await execute(job);
        await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ result }) });
      } catch (error) {
        await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) });
      }
    }
    return true;
  } catch (error) {
    return { ok: false, error: safeErrorDetail(error) };
  }
}

console.log(`Georgie Mac Agent online as ${DEVICE_ID}`);
let consecutiveFailures = 0;
let lastFailureSignature = "";
async function runForever() {
  while (true) {
    const outcome = await cycle();
    if (outcome === true) {
      if (consecutiveFailures > 0) console.log(new Date().toISOString(), `Georgie server connection recovered after ${consecutiveFailures} failed cycle(s)`);
      consecutiveFailures = 0;
      lastFailureSignature = "";
      await delay(INTERVAL);
      continue;
    }
    consecutiveFailures += 1;
    const detail = outcome?.error || { message: "Unknown polling failure", code: null, syscall: null, hostname: null };
    const signature = JSON.stringify(detail);
    if (signature !== lastFailureSignature || consecutiveFailures === 1 || consecutiveFailures % 10 === 0) {
      console.error(new Date().toISOString(), JSON.stringify({ event: "mac_agent_connection_failed", consecutiveFailures, serverOrigin: new URL(BASE).origin, ...detail }));
      lastFailureSignature = signature;
    }
    const backoff = Math.min(MAX_BACKOFF, INTERVAL * (2 ** Math.min(6, consecutiveFailures - 1)));
    await delay(backoff);
  }
}
void runForever();
