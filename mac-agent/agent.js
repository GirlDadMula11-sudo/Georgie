import "dotenv/config";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execFileAsync = promisify(execFile);
const BASE = String(process.env.GEORGIE_SERVER_URL || "").replace(/\/$/, "");
const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || os.hostname();
const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;
const INTERVAL = Math.max(3000, Number(process.env.GEORGIE_MAC_POLL_MS || 5000));

if (!BASE || !TOKEN) throw new Error("GEORGIE_SERVER_URL and GEORGIE_MAC_AGENT_TOKEN are required");

const SAFE_APPS = new Set(["Safari","Google Chrome","Notes","Mail","Finder","Calendar","Messages","Preview","System Settings"]);

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
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
      const target = String(a.path || "");
      const allowedRoots = [os.homedir() + "/Desktop", os.homedir() + "/Documents", os.homedir() + "/Downloads"];
      if (!allowedRoots.some(root => target === root || target.startsWith(root + "/"))) throw new Error("Path is outside allowed user folders");
      const text = await fs.readFile(target, "utf8");
      return { path: target, text: text.slice(0, 100000) };
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
