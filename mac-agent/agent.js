import "dotenv/config";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execFileAsync = promisify(execFile);
const BASE = String(process.env.GEORGIE_SERVER_URL || "").replace(/\/$/, "");
const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || os.hostname();
const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;
const INTERVAL = Math.max(3000, Number(process.env.GEORGIE_MAC_POLL_MS || 5000));

if (!BASE || !TOKEN) throw new Error("GEORGIE_SERVER_URL and GEORGIE_MAC_AGENT_TOKEN are required");

const SAFE_APPS = new Set(["Safari","Google Chrome","Notes","Mail","Finder","Calendar","Messages","Preview","System Settings","Microsoft Excel","Microsoft Word","Adobe Acrobat Reader"]);
const SAFE_KEYS = new Set(["return","tab","escape","space","delete","up arrow","down arrow","left arrow","right arrow"]);

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

function assertUserFile(target) {
  const resolved = path.resolve(String(target || ""));
  const allowedRoots = ["Desktop","Documents","Downloads"].map(name => path.join(os.homedir(), name));
  if (!allowedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep))) throw new Error("Path is outside allowed user folders");
  return resolved;
}

async function execute(job) {
  const a = job.args || {};
  switch (job.action) {
    case "system.info":
      return { hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(), uptime: os.uptime() };
    case "app.open": {
      if (!SAFE_APPS.has(a.app)) throw new Error("Application is not allowlisted");
      await execFileAsync("open", ["-a", a.app]);
      return { opened: a.app };
    }
    case "app.activate": {
      if (!SAFE_APPS.has(a.app)) throw new Error("Application is not allowlisted");
      await runAppleScript(`tell application ${JSON.stringify(a.app)} to activate`);
      return { activated: a.app };
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
    case "screen.capture": {
      const target = path.join(os.tmpdir(), `georgie-screen-${Date.now()}.png`);
      await execFileAsync("screencapture", ["-x", target], { timeout: 15000 });
      const bytes = await fs.readFile(target);
      await fs.unlink(target).catch(() => {});
      return { mimeType: "image/png", base64: bytes.toString("base64").slice(0, 8_000_000) };
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
