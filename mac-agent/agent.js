import "dotenv/config";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execFileAsync = promisify(execFile);
const BASE = String(process.env.GEORGIE_SERVER_URL || "").replace(/\/$/, "");
const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || "primary-mac";
const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;
const INTERVAL = Math.max(750, Number(process.env.GEORGIE_MAC_POLL_MS || 1000));

if (!BASE || !TOKEN) throw new Error("GEORGIE_SERVER_URL and GEORGIE_MAC_AGENT_TOKEN are required");

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
  const { stdout = "", stderr = "" } = await execFileAsync(command, args, { timeout: options.timeout || 30000, maxBuffer: 4 * 1024 * 1024, cwd: options.cwd });
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
      let result;
      try { result = await runDeveloper("rg", ["-n", "--hidden", "--glob", "!.git/**", "--glob", "!node_modules/**", "--glob", "!.env*", "--", query, repo]); }
      catch (error) { if (error?.code === 1) result = { stdout: "", stderr: "" }; else throw error; }
      return { repo, query, matches: result.stdout.slice(0, 200000), readOnly: true };
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
    await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/heartbeat`, { method: "POST", body: JSON.stringify({ hostname: os.hostname(), platform: os.platform(), arch: os.arch() }) });
    const payload = await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs?limit=5`);
    for (const job of payload.jobs || []) {
      try {
        const result = await execute(job);
        await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ result }) });
      } catch (error) {
        await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) });
      }
    }
  } catch (error) {
    console.error(new Date().toISOString(), error instanceof Error ? error.message : error);
  }
}

console.log(`Georgie Mac Agent online as ${DEVICE_ID}`);
cycle();
setInterval(cycle, INTERVAL);
