import "dotenv/config";
import os from "os";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import crypto from "crypto";
import { buildNeoObservationScript, validateNeoObservation, buildNeoStaticContractInspectionScript, validateNeoStaticContractInspection } from "./neo-mail-reader.js";
import { verifyNeoCdpSession } from "./neo-cdp-reader.js";
import { reconcileRemoteIdenticalDirtyPaths } from "./git-update-reconcile.js";
import { buildSeoPhase2WordpressPageScriptWithRollback, buildSeoPhase2WordpressRollbackScript, stripRollbackBundle, validateSeoPhase2MacRequest } from "./seo-phase2-writer-v2.js";

const execFileAsync = promisify(execFile);
const BASE = String(process.env.GEORGIE_SERVER_URL || "").replace(/\/$/, "");
const DEVICE_ID = process.env.GEORGIE_MAC_DEVICE_ID || "primary-mac";
const AGENT_VERSION = "2.2.48";
const ROJO_RELEASE = Object.freeze({
  version: "7.7.0",
  url: "https://github.com/rojo-rbx/rojo/releases/download/v7.7.0/rojo-7.7.0-macos-x86_64.zip",
  archiveSha256: "9bd69697ca3a0abf0ec847c779013e7315501b2d997d63d5e1766e14d49d9c66",
  binarySha256: "571e186637ddac6961e97e5b744f8fec33c3ef02fa77ba9fa2e63c2ad3b5f2a8"
});
const TOKEN = process.env.GEORGIE_MAC_AGENT_TOKEN;
const INTERVAL = Math.max(750, Number(process.env.GEORGIE_MAC_POLL_MS || 1000));
const MAX_BACKOFF = Math.max(INTERVAL, Number(process.env.GEORGIE_MAC_MAX_BACKOFF_MS || 30000));
const HEALTH_DIR = path.join(os.homedir(), "Library", "Application Support", "Georgie");
const HEALTH_FILE = path.join(HEALTH_DIR, "mac-agent-health.json");
const SEO_PHASE2_EXECUTION_FILE = path.join(HEALTH_DIR, "seo-phase2-executions.json");
async function writeDaemonHealth(extra = {}) {
  await fs.mkdir(HEALTH_DIR, { recursive: true, mode: 0o700 });
  const payload = { deviceId: DEVICE_ID, agentVersion: AGENT_VERSION, pid: process.pid, serverOrigin: new URL(BASE).origin, successfulCycleAt: new Date().toISOString(), ...extra };
  const temp = HEALTH_FILE + "." + process.pid + ".tmp";
  await fs.writeFile(temp, JSON.stringify(payload), { mode: 0o600 });
  await fs.rename(temp, HEALTH_FILE);
}

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

const SAFE_APPS = ["Safari","Google Chrome","Notes","Mail","Finder","Calendar","Messages","Preview","System Settings","Microsoft Excel","Microsoft Word","Adobe Acrobat Reader","RobloxStudio"];
const SAFE_KEYS = new Set(["return","tab","escape","space","delete","up arrow","down arrow","left arrow","right arrow"]);
function canonicalApp(value) {
  const requested = String(value || "").trim().toLowerCase();
  const app = SAFE_APPS.find(name => name.toLowerCase() === requested);
  if (!app) throw new Error("Application is not allowlisted");
  return app;
}

function validateRobloxProjectRequest(args = {}) {
  const projectName = String(args.projectName || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$/.test(projectName)) throw new Error("ROBLOX_PROJECT_NAME_REJECTED");
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const files = Array.isArray(args.files) && args.files.length ? args.files : defaultRobloxPrototypeFiles(args.designBrief);
  if (!files.length || files.length > 80) throw new Error("ROBLOX_PROJECT_FILES_REJECTED");
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const relative = String(file?.path || "").replaceAll("\\", "/");
    if (!/^[A-Za-z0-9_. -]+(?:\/[A-Za-z0-9_. -]+)*$/.test(relative) || relative.split("/").includes("..") || !/\.(?:lua|luau|json|md)$/i.test(relative)) throw new Error("ROBLOX_PROJECT_PATH_REJECTED");
    const content = String(file?.content || "");
    totalBytes += Buffer.byteLength(content);
    return { relative, content };
  });
  if (totalBytes > 1_000_000) throw new Error("ROBLOX_PROJECT_SIZE_REJECTED");
  if (!normalized.some((file) => file.relative === "default.project.json")) throw new Error("ROBLOX_PROJECT_MANIFEST_REQUIRED");
  return { projectName, slug, files: normalized, totalBytes };
}

function defaultRobloxPrototypeFiles(designBrief = "") {
  const brief = String(designBrief || "Original family-friendly suspense horror prototype designed with Makayla").slice(0, 2000);
  const manifest = { name: "MakaylaHorrorPrototype", tree: { "$className": "DataModel", "ReplicatedStorage": { "$className": "ReplicatedStorage" }, "ServerScriptService": { "$className": "ServerScriptService", "$path": "src/server" }, "StarterPlayer": { "$className": "StarterPlayer", "StarterPlayerScripts": { "$className": "StarterPlayerScripts", "$path": "src/client" } } } };
  const server = `-- Georgie-generated original Roblox horror prototype\nlocal Lighting=game:GetService("Lighting")\nlocal Players=game:GetService("Players")\nLighting.ClockTime=0.5 Lighting.Brightness=0.7 Lighting.FogEnd=115 Lighting.FogColor=Color3.fromRGB(24,20,18)\nlocal world=Instance.new("Folder",workspace) world.Name="MakaylaPrototype"\nlocal function part(name,size,pos,color,material) local p=Instance.new("Part",world) p.Name=name p.Anchored=true p.Size=size p.Position=pos p.Color=color p.Material=material or Enum.Material.WoodPlanks return p end\npart("Ground",Vector3.new(150,1,150),Vector3.new(0,-1,0),Color3.fromRGB(35,31,27),Enum.Material.Ground)\nfor i=-3,3 do part("HallFloor",Vector3.new(18,1,18),Vector3.new(0,0,i*18),Color3.fromRGB(62,48,37)) part("WallL",Vector3.new(1,14,18),Vector3.new(-9,7,i*18),Color3.fromRGB(45,42,38),Enum.Material.Concrete) part("WallR",Vector3.new(1,14,18),Vector3.new(9,7,i*18),Color3.fromRGB(45,42,38),Enum.Material.Concrete) end\nlocal spawn=Instance.new("SpawnLocation",world) spawn.Anchored=true spawn.Size=Vector3.new(6,1,6) spawn.Position=Vector3.new(0,1,-52) spawn.Neutral=true\nlocal keys={} for i,z in ipairs({-30,5,38}) do local k=part("Relic"..i,Vector3.new(1.4,1.4,1.4),Vector3.new(i%2==0 and 5 or -5,2,z),Color3.fromRGB(210,170,65),Enum.Material.Neon) keys[i]=k end\nlocal exit=part("ExitDoor",Vector3.new(8,12,1),Vector3.new(0,6,63),Color3.fromRGB(70,20,18),Enum.Material.Wood)\nlocal collected={} local count=0\nfor _,k in ipairs(keys) do k.Touched:Connect(function(hit) local pl=Players:GetPlayerFromCharacter(hit.Parent) if pl and not collected[k] then collected[k]=true count+=1 k:Destroy() if count==#keys then exit.Color=Color3.fromRGB(35,150,70) exit.CanCollide=false end end end) end\nlocal enemy=part("TheWatcher",Vector3.new(4,8,4),Vector3.new(0,4,28),Color3.fromRGB(12,12,12),Enum.Material.SmoothPlastic) enemy.Anchored=false enemy.CanCollide=false\ntask.spawn(function() while enemy.Parent do task.wait(.35) local target,dist=nil,80 for _,pl in ipairs(Players:GetPlayers()) do local root=pl.Character and pl.Character:FindFirstChild("HumanoidRootPart") if root then local d=(root.Position-enemy.Position).Magnitude if d<dist then target=root dist=d end end end if target then local direction=(target.Position-enemy.Position) if direction.Magnitude>1 then enemy.AssemblyLinearVelocity=direction.Unit*10 end end end end)\nprint("Georgie prototype loaded: ${brief.replaceAll("`", "'").replaceAll("${", "")}")\n`;
  const client = `local Players=game:GetService("Players") local Lighting=game:GetService("Lighting")\nlocal player=Players.LocalPlayer local gui=Instance.new("ScreenGui",player:WaitForChild("PlayerGui")) gui.Name="MakaylaObjective"\nlocal label=Instance.new("TextLabel",gui) label.Size=UDim2.fromOffset(390,54) label.Position=UDim2.new(.5,-195,0,24) label.BackgroundTransparency=.25 label.BackgroundColor3=Color3.fromRGB(8,8,8) label.TextColor3=Color3.fromRGB(232,195,95) label.Font=Enum.Font.GothamBold label.TextScaled=true label.Text="FIND 3 RELICS. ESCAPE THE WATCHER."\nlocal light=Instance.new("PointLight") light.Range=28 light.Brightness=1.8 light.Color=Color3.fromRGB(255,225,175)\nplayer.CharacterAdded:Connect(function(char) light.Parent=char:WaitForChild("Head") end) if player.Character then light.Parent=player.Character:WaitForChild("Head") end\n`;
  return [
    { path: "default.project.json", content: JSON.stringify(manifest, null, 2) },
    { path: "src/server/Main.server.luau", content: server },
    { path: "src/client/Main.client.luau", content: client },
    { path: "README.md", content: `# Makayla Horror Prototype\n\n${brief}\n\nGenerated by Georgie for private playtesting. Collect three relics, avoid The Watcher, and reach the exit.` }
  ];
}

async function buildRobloxPrototype(args = {}) {
  const request = validateRobloxProjectRequest(args);
  const projectsRoot = path.join(os.homedir(), "Documents", "Georgie Roblox Projects");
  const projectRoot = path.join(projectsRoot, request.slug);
  await fs.mkdir(projectRoot, { recursive: true, mode: 0o700 });
  for (const file of request.files) {
    const target = path.resolve(projectRoot, file.relative);
    if (!target.startsWith(projectRoot + path.sep)) throw new Error("ROBLOX_PROJECT_PATH_ESCAPE_REJECTED");
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, file.content, { mode: 0o600 });
    await fs.rename(temp, target);
  }
  JSON.parse(await fs.readFile(path.join(projectRoot, "default.project.json"), "utf8"));
  const output = path.join(projectRoot, "Prototype.rbxlx");
  let rojo = null;
  for (const candidate of [path.join(os.homedir(), ".local", "bin", "rojo"), "/opt/homebrew/bin/rojo", "/usr/local/bin/rojo", path.join(os.homedir(), ".cargo", "bin", "rojo")]) {
    try { await fs.access(candidate); rojo = candidate; break; } catch {}
  }
  if (!rojo) return { status: "blocked_tooling", projectRoot, filesWritten: request.files.length, totalBytes: request.totalBytes, missingPrecondition: "Rojo CLI", nextAction: "Install Rojo once, then resume this same prototype build.", preserved: true };
  const built = await execFileAsync(rojo, ["build", path.join(projectRoot, "default.project.json"), "-o", output], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const stat = await fs.stat(output);
  if (stat.size < 100) throw new Error("ROBLOX_PROTOTYPE_BUILD_EMPTY");
  if (args.openInStudio !== false) await execFileAsync("open", ["-a", "RobloxStudio", output], { timeout: 30000 });
  return { status: "completed", projectRoot, output, outputBytes: stat.size, filesWritten: request.files.length, totalBytes: request.totalBytes, openedInStudio: args.openInStudio !== false, buildOutput: String(built.stdout || "").slice(0, 2000) };
}

async function sha256File(target) {
  return crypto.createHash("sha256").update(await fs.readFile(target)).digest("hex");
}

async function verifiedPinnedRojo() {
  const target = path.join(os.homedir(), ".local", "bin", "rojo");
  try {
    await fs.access(target);
    const [binarySha256, versionResult] = await Promise.all([
      sha256File(target),
      execFileAsync(target, ["--version"], { timeout: 30000, maxBuffer: 1024 * 1024 })
    ]);
    const version = versionResult.stdout.trim();
    if (binarySha256 === ROJO_RELEASE.binarySha256 && version === `Rojo ${ROJO_RELEASE.version}`) {
      return { path: target, version, archiveSha256: ROJO_RELEASE.archiveSha256, binarySha256, installed: false };
    }
  } catch {}
  return null;
}

async function installPinnedRojo() {
  const existing = await verifiedPinnedRojo();
  if (existing) return existing;
  if (os.arch() !== "x64") throw new Error(`ROJO_PREBUILT_ARCH_UNSUPPORTED:${os.arch()}`);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "georgie-rojo-"));
  const archive = path.join(temporaryRoot, "rojo.zip");
  const extracted = path.join(temporaryRoot, "expanded");
  const targetDirectory = path.join(os.homedir(), ".local", "bin");
  const target = path.join(targetDirectory, "rojo");
  const staged = `${target}.${process.pid}.tmp`;
  try {
    await execFileAsync("/usr/bin/curl", ["--fail", "--location", "--silent", "--show-error", "--retry", "3", "--output", archive, ROJO_RELEASE.url], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const archiveSha256 = await sha256File(archive);
    if (archiveSha256 !== ROJO_RELEASE.archiveSha256) throw new Error(`ROJO_ARCHIVE_CHECKSUM_MISMATCH:${archiveSha256}`);
    await fs.mkdir(extracted, { recursive: true, mode: 0o700 });
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", archive, extracted], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const binary = path.join(extracted, "rojo");
    const binarySha256 = await sha256File(binary);
    if (binarySha256 !== ROJO_RELEASE.binarySha256) throw new Error(`ROJO_BINARY_CHECKSUM_MISMATCH:${binarySha256}`);
    await fs.mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    await fs.copyFile(binary, staged);
    await fs.chmod(staged, 0o755);
    await fs.rename(staged, target);
    const installed = await verifiedPinnedRojo();
    if (!installed) throw new Error("ROJO_PINNED_INSTALL_NOT_VERIFIED");
    return { ...installed, installed: true };
  } finally {
    await fs.unlink(staged).catch(() => {});
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function inspectRobloxPrototypeSources(projectRoot) {
  const expectedRoot = path.join(os.homedir(), "Documents", "Georgie Roblox Projects", "makayla-horror-prototype");
  if (path.resolve(projectRoot) !== expectedRoot) throw new Error("ROBLOX_PLAY_TEST_PROJECT_REJECTED");
  return Promise.all([
    fs.readFile(path.join(expectedRoot, "default.project.json"), "utf8"),
    fs.readFile(path.join(expectedRoot, "src", "server", "Main.server.luau"), "utf8"),
    fs.readFile(path.join(expectedRoot, "src", "client", "Main.client.luau"), "utf8")
  ]).then(([manifestSource, serverSource, clientSource]) => {
    const manifest = JSON.parse(manifestSource);
    const checks = {
      spawning: /SpawnLocation/.test(serverSource) && /spawn\.Position=Vector3\.new\(0,1,-52\)/.test(serverSource),
      threeRelics: /\{-30,5,38\}/.test(serverSource) && /Relic/.test(serverSource) && /k\.Touched:Connect/.test(serverSource),
      watcherChase: /TheWatcher/.test(serverSource) && /Players:GetPlayers\(\)/.test(serverSource) && /AssemblyLinearVelocity=direction\.Unit\*10/.test(serverSource),
      exitDoorUnlock: /ExitDoor/.test(serverSource) && /count==#keys/.test(serverSource) && /exit\.CanCollide=false/.test(serverSource),
      lighting: /Lighting\.ClockTime=0\.5/.test(serverSource) && /Lighting\.Brightness=0\.7/.test(serverSource) && /Lighting\.FogEnd=115/.test(serverSource),
      controls: Boolean(manifest?.tree?.StarterPlayer?.StarterPlayerScripts?.["$path"] === "src/client") && /Players\.LocalPlayer/.test(clientSource) && /CharacterAdded:Connect/.test(clientSource)
    };
    return { expectedRoot, serverSource, checks, defects: Object.entries(checks).filter(([,passed]) => !passed).map(([name]) => `STATIC_${name.toUpperCase()}_CHECK_FAILED`) };
  });
}

async function recentRobloxStudioLogs(sinceMs) {
  const logRoot = path.join(os.homedir(), "Library", "Logs", "Roblox");
  const entries = await fs.readdir(logRoot, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.log$/i.test(entry.name)) continue;
    const target = path.join(logRoot, entry.name);
    const stat = await fs.stat(target).catch(() => null);
    if (stat && stat.mtimeMs >= sinceMs - 10_000) candidates.push({ target, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates;
}

async function waitForRobloxRuntimeMarker(sinceMs, marker, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let candidates = [];
  while (Date.now() < deadline) {
    candidates = await recentRobloxStudioLogs(sinceMs);
    for (const candidate of candidates) {
      const log = await fs.readFile(candidate.target, "utf8").catch(() => "");
      const markerIndex = log.lastIndexOf(marker);
      if (markerIndex >= 0) return { observed: true, logPath: candidate.target, logBytes: candidate.size, excerpt: log.slice(markerIndex, markerIndex + 500), searchedLogCount: candidates.length };
    }
    await delay(500);
  }
  return { observed: false, logPath: candidates[0]?.target || null, logBytes: candidates[0]?.size || 0, excerpt: "", searchedLogCount: candidates.length };
}

async function waitForRobloxStudioArtifactWindow(artifact, timeoutMs = 30000) {
  const expectedArtifact = path.resolve(String(artifact || ""));
  if (!expectedArtifact.endsWith(`${path.sep}Prototype.rbxlx`)) throw new Error("ROBLOX_STUDIO_ARTIFACT_WINDOW_REJECTED");
  const deadline = Date.now() + timeoutMs;
  let windowNames = "";
  let windowTitle = "";
  let documentPath = "";
  while (Date.now() < deadline) {
    const observation = await runAppleScript(`set expectedArtifact to ${JSON.stringify(expectedArtifact)}
tell application "System Events"
if not (exists process "RobloxStudio") then return ""
tell process "RobloxStudio"
set frontmost to true
set studioWindowNames to {}
repeat with studioWindow in windows
set studioWindowTitle to name of studioWindow as string
set end of studioWindowNames to studioWindowTitle
set studioDocument to ""
try
set studioDocument to value of attribute "AXDocument" of studioWindow as string
end try
if studioDocument contains expectedArtifact or studioWindowTitle contains "Prototype.rbxlx" then
try
perform action "AXRaise" of studioWindow
end try
try
set value of attribute "AXMain" of studioWindow to true
end try
return "MATCHED" & linefeed & studioWindowTitle & linefeed & studioDocument & linefeed & (studioWindowNames as string)
end if
end repeat
return "WAITING" & linefeed & linefeed & linefeed & (studioWindowNames as string)
end tell
end tell`).catch(() => "");
    const [state = "", observedTitle = "", observedDocument = "", ...observedNames] = String(observation).split("\n");
    windowNames = observedNames.join("\n");
    windowTitle = observedTitle;
    documentPath = observedDocument;
    if (state === "MATCHED") return { ready: true, matched: true, windowNames, windowTitle, documentPath };
    await delay(500);
  }
  return { ready: false, matched: false, windowNames, windowTitle, documentPath };
}

async function openRobloxStudioArtifactThroughFileDialog(artifact) {
  const expectedArtifact = path.resolve(String(artifact || ""));
  if (!expectedArtifact.endsWith(`${path.sep}Prototype.rbxlx`)) throw new Error("ROBLOX_STUDIO_FILE_OPEN_REJECTED");
  const evidence = await runAppleScript(`set expectedArtifact to ${JSON.stringify(expectedArtifact)}
tell application "RobloxStudio" to activate
tell application "System Events"
if not (exists process "RobloxStudio") then error "ROBLOX_STUDIO_NOT_RUNNING"
tell process "RobloxStudio"
set frontmost to true
keystroke "o" using {command down}
set openPanel to missing value
repeat 50 times
repeat with candidateWindow in windows
try
if (name of candidateWindow as string) contains "Open Roblox File" then set openPanel to candidateWindow
end try
end repeat
if openPanel is not missing value then exit repeat
delay 0.1
end repeat
if openPanel is missing value then error "ROBLOX_STUDIO_OPEN_PANEL_NOT_FOUND"
keystroke "g" using {command down, shift down}
set goSheet to missing value
repeat 50 times
try
if (count of sheets of openPanel) > 0 then set goSheet to sheet 1 of openPanel
end try
if goSheet is not missing value then exit repeat
delay 0.1
end repeat
if goSheet is missing value then error "ROBLOX_STUDIO_GO_TO_FOLDER_SHEET_NOT_FOUND"
set pathField to missing value
repeat 30 times
try
set pathField to text field 1 of goSheet
end try
if pathField is not missing value then exit repeat
delay 0.1
end repeat
if pathField is missing value then error "ROBLOX_STUDIO_GO_TO_FOLDER_FIELD_NOT_FOUND"
set value of attribute "AXValue" of pathField to expectedArtifact
try
perform action "AXConfirm" of pathField
on error
key code 36
end try
repeat 50 times
try
if (count of sheets of openPanel) is 0 then exit repeat
end try
delay 0.1
end repeat
try
if (count of sheets of openPanel) > 0 then error "ROBLOX_STUDIO_GO_TO_FOLDER_SHEET_STUCK"
end try
set openButton to missing value
repeat 50 times
try
set candidateButton to button "Open" of openPanel
if enabled of candidateButton then set openButton to candidateButton
end try
if openButton is not missing value then exit repeat
delay 0.1
end repeat
if openButton is missing value then error "ROBLOX_STUDIO_OPEN_BUTTON_NOT_READY"
perform action "AXPress" of openButton
repeat 100 times
set panelStillOpen to false
repeat with candidateWindow in windows
try
if (name of candidateWindow as string) contains "Open Roblox File" then set panelStillOpen to true
end try
end repeat
if panelStillOpen is false then return "DIALOG_CLOSED"
delay 0.1
end repeat
error "ROBLOX_STUDIO_OPEN_PANEL_STUCK"
end tell
end tell`);
  if (String(evidence).trim() !== "DIALOG_CLOSED") throw new Error("ROBLOX_STUDIO_FILE_OPEN_UNVERIFIED");
  return { stage: "dialog_closed" };
}

async function activateRobloxStudioPlayMode(startedAtMs, artifact) {
  let studioWindow = await waitForRobloxStudioArtifactWindow(artifact, 8000);
  let studioFileOpenAttempted = false;
  let studioFileOpenError = null;
  let studioFileOpenStage = null;
  if (!studioWindow.ready) {
    studioFileOpenAttempted = true;
    try {
      const fileOpen = await openRobloxStudioArtifactThroughFileDialog(artifact);
      studioFileOpenStage = fileOpen.stage;
    } catch (error) {
      studioFileOpenError = String(error instanceof Error ? error.message : error).slice(0, 1000);
    }
    studioWindow = await waitForRobloxStudioArtifactWindow(artifact, 15000);
  }
  if (!studioWindow.ready) return { observed: false, logPath: null, logBytes: 0, excerpt: "", searchedLogCount: 0, activationAttempts: 0, artifactOpenRequested: true, studioFileOpenAttempted, studioFileOpenError, studioFileOpenStage, studioWindowReady: false, studioWindowMatched: false, studioWindowNames: studioWindow.windowNames, studioWindowTitle: studioWindow.windowTitle, studioDocumentPath: studioWindow.documentPath };
  await delay(1500);
  let runtime = { observed: false, logPath: null, logBytes: 0, excerpt: "", searchedLogCount: 0 };
  for (let activationAttempts = 1; activationAttempts <= 2; activationAttempts += 1) {
    await runAppleScript('tell application "RobloxStudio" to activate');
    studioWindow = await waitForRobloxStudioArtifactWindow(artifact, 5000);
    if (!studioWindow.ready) break;
    await runAppleScript('tell application "System Events" to tell process "RobloxStudio" to key code 96');
    runtime = await waitForRobloxRuntimeMarker(startedAtMs, "Georgie prototype loaded:", 20000);
    if (runtime.observed) return { ...runtime, activationAttempts, artifactOpenRequested: true, studioFileOpenAttempted, studioFileOpenError, studioFileOpenStage, studioWindowReady: true, studioWindowMatched: true, studioWindowNames: studioWindow.windowNames, studioWindowTitle: studioWindow.windowTitle, studioDocumentPath: studioWindow.documentPath };
    if (activationAttempts < 2) {
      await runAppleScript('tell application "System Events" to tell process "RobloxStudio" to key code 96 using {shift down}').catch(() => {});
      await delay(1500);
    }
  }
  return { ...runtime, activationAttempts: 2, artifactOpenRequested: true, studioFileOpenAttempted, studioFileOpenError, studioFileOpenStage, studioWindowReady: studioWindow.ready, studioWindowMatched: studioWindow.matched, studioWindowNames: studioWindow.windowNames, studioWindowTitle: studioWindow.windowTitle, studioDocumentPath: studioWindow.documentPath };
}

async function playTestRobloxPrototype(args = {}) {
  const projectRoot = String(args.projectRoot || "");
  const artifact = path.join(projectRoot, "Prototype.rbxlx");
  const expectedArtifact = path.join(os.homedir(), "Documents", "Georgie Roblox Projects", "makayla-horror-prototype", "Prototype.rbxlx");
  if (path.resolve(artifact) !== expectedArtifact) throw new Error("ROBLOX_PLAY_TEST_ARTIFACT_REJECTED");
  const sourceInspection = await inspectRobloxPrototypeSources(projectRoot);
  const artifactStat = await fs.stat(artifact);
  if (artifactStat.size < 100) throw new Error("ROBLOX_PLAY_TEST_ARTIFACT_EMPTY");
  if (sourceInspection.defects.length) return { status: "blocked", artifact, artifactBytes: artifactStat.size, checks: sourceInspection.checks, defects: sourceInspection.defects, playStarted: false, playStopped: false };
  const startedAtMs = Date.now();
  const captureTarget = path.join(os.tmpdir(), `georgie-roblox-playtest-${startedAtMs}.png`);
  let playStopped = false;
  try {
    await execFileAsync("open", ["-a", "RobloxStudio", artifact], { timeout: 30000 });
    if (!await waitForAppProcess("RobloxStudio", 15000)) throw new Error("ROBLOX_STUDIO_NOT_RUNNING");
    const runtime = await activateRobloxStudioPlayMode(startedAtMs, artifact);
    let screenshotSha256 = null;
    let screenshotError = null;
    try {
      await execFileAsync("screencapture", ["-x", captureTarget], { timeout: 15000 });
      screenshotSha256 = await sha256File(captureTarget);
    } catch (error) {
      screenshotError = String(error instanceof Error ? error.message : error).slice(0, 1000);
    }
    await runAppleScript('tell application "System Events" to key code 96 using {shift down}');
    playStopped = true;
    const defects = runtime.observed ? [] : [runtime.studioWindowMatched ? "RUNTIME_PROTOTYPE_MARKER_NOT_OBSERVED" : "ROBLOX_PROTOTYPE_WINDOW_NOT_READY"];
    return {
      status: defects.length ? "blocked" : "completed",
      artifact,
      artifactBytes: artifactStat.size,
      checks: sourceInspection.checks,
      defects,
      playStarted: runtime.observed,
      playStopped,
      artifactOpenRequested: runtime.artifactOpenRequested,
      studioFileOpenAttempted: runtime.studioFileOpenAttempted,
      studioFileOpenError: runtime.studioFileOpenError,
      studioFileOpenStage: runtime.studioFileOpenStage,
      studioWindowReady: runtime.studioWindowReady,
      studioWindowMatched: runtime.studioWindowMatched,
      studioWindowNames: runtime.studioWindowNames,
      studioWindowTitle: runtime.studioWindowTitle,
      studioDocumentPath: runtime.studioDocumentPath,
      activationAttempts: runtime.activationAttempts,
      runtimeMarkerObserved: runtime.observed,
      runtimeLogPath: runtime.logPath,
      runtimeLogBytes: runtime.logBytes,
      runtimeSearchedLogCount: runtime.searchedLogCount,
      runtimeExcerpt: runtime.excerpt,
      screenshotCaptured: Boolean(screenshotSha256),
      screenshotSha256,
      screenshotError,
      testedAt: new Date().toISOString()
    };
  } finally {
    if (!playStopped) await runAppleScript('tell application "System Events" to key code 96 using {shift down}').catch(() => {});
    await fs.unlink(captureTarget).catch(() => {});
  }
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

const GOVERNED_WORDPRESS_BROWSER_HOSTS = Object.freeze(["sierramarketinginc.com", "hostinger.com"]);
function governedWordpressHost(rawUrl) {
  try {
    const host = new URL(String(rawUrl || "")).hostname.toLowerCase();
    return GOVERNED_WORDPRESS_BROWSER_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`)) ? host : null;
  } catch { return null; }
}
async function inspectGovernedWordpressSession(args = {}) {
  if (args.authority !== "read_only" || args.operation !== "inspect_session") throw new Error("GOVERNED_BROWSER_AUTHORIZATION_REJECTED");
  if (String(args.siteOrigin || "").replace(/\/$/, "") !== "https://sierramarketinginc.com") throw new Error("GOVERNED_BROWSER_SITE_REJECTED");
  const script = `
const approved = ${JSON.stringify(GOVERNED_WORDPRESS_BROWSER_HOSTS)};
const maxPerTab = 12000;
const result = { observedAt: new Date().toISOString(), tabs: [], browserErrors: [] };
function clean(value, max) { return String(value || '').replace(/\\u0000/g, '').slice(0, max); }
function approvedUrl(raw) {
  const match = String(raw || '').match(/^https?:\\/\\/([^\\/?#]+)/i);
  if (!match) return false;
  const host = match[1].split(':')[0].toLowerCase();
  return approved.some(domain => host === domain || host.endsWith('.' + domain));
}
function safeUrl(raw) { return clean(String(raw || '').replace(/([?&#](?:api[_-]?key|token|secret|password|code|session|auth)=)[^&#]*/ig, '$1[REDACTED]').replace(/#.*$/, ''), 4000); }
function redact(value) { return clean(String(value || '').replace(/(?:api[_ -]?key|password|secret|access[_ -]?token|refresh[_ -]?token|authorization)\\s*[:=]?\\s*[^\\n]{1,240}/ig, '[REDACTED SENSITIVE VALUE]').replace(/\\b(?:sk|sb_secret|rnd|ghp|github_pat)_[A-Za-z0-9_-]{8,}\\b/g, '[REDACTED CREDENTIAL]'), maxPerTab); }
function pageObservationScript() {
  return "(() => { const body = document.body ? document.body.innerText : ''; const admin = /\\/wp-admin\\//.test(location.pathname) && !/wp-login\\.php/.test(location.pathname); return JSON.stringify({ text: String(body || '').slice(0," + maxPerTab + "), wordpressAdminAuthenticated: admin, pathname: location.pathname }); })()";
}
try {
  const chrome = Application('Google Chrome');
  if (chrome.running()) chrome.windows().forEach((win, wi) => {
    const active = Number(win.activeTabIndex());
    win.tabs().forEach((tab, ti) => {
      let rawUrl = '';
      try { rawUrl = clean(tab.url(), 4000); } catch (error) { return; }
      if (!approvedUrl(rawUrl)) return;
      const item = { browser: 'Google Chrome', window: wi + 1, tab: ti + 1, active: (ti + 1) === active, title: '', url: safeUrl(rawUrl), contentApproved: true, content: null, contentError: null, wordpressAdminAuthenticated: false, pathname: null };
      try { item.title = clean(tab.title(), 1000); } catch (error) { item.contentError = clean(error.message || error, 1000); }
      try {
        const observed = JSON.parse(String(tab.execute({ javascript: pageObservationScript() }) || '{}'));
        item.content = redact(observed.text);
        item.wordpressAdminAuthenticated = observed.wordpressAdminAuthenticated === true;
        item.pathname = clean(observed.pathname, 1000);
      } catch (error) { item.contentError = clean(error.message || error, 1000); }
      result.tabs.push(item);
    });
  });
} catch (error) { result.browserErrors.push({ browser: 'Google Chrome', error: clean(error.message || error, 1000) }); }
result.tabCount = result.tabs.length;
result.contentInspectedCount = result.tabs.filter(tab => tab.content !== null).length;
JSON.stringify(result);
`;
  const observed = JSON.parse(await runJxa(script) || "{}");
  const tabs = Array.isArray(observed.tabs) ? observed.tabs : [];
  if (!tabs.length) throw new Error("GOVERNED_BROWSER_APPROVED_TAB_NOT_FOUND");
  return {
    governedBrowserInspection: {
      observedAt: observed.observedAt,
      approvedHosts: [...GOVERNED_WORDPRESS_BROWSER_HOSTS],
      tabs,
      tabCount: tabs.length,
      contentInspectedCount: tabs.filter(tab => tab.content !== null).length,
      wordpressAdminAuthenticated: tabs.some(tab => tab.wordpressAdminAuthenticated === true),
      browserErrors: observed.browserErrors || []
    },
    authority: "read_only",
    siteOrigin: "https://sierramarketinginc.com",
    credentialRedactionApplied: true,
    formValuesCaptured: false,
    credentialsTransferred: false,
    mutationPerformed: false,
    prohibitedActions: ["form.submit", "content.write", "wordpress.publish", "dns.write", "email.send"]
  };
}

async function repairWordpressLinkIntegrity(args = {}) {
  if (args.authority !== "reversible_write" || args.operation !== "repair_link_integrity") throw new Error("WORDPRESS_REPAIR_AUTHORIZATION_REJECTED");
  if (String(args.siteOrigin || "").replace(/\/$/, "") !== "https://sierramarketinginc.com") throw new Error("WORDPRESS_REPAIR_SITE_REJECTED");
  const pageScript = `(() => {
    const nonce = window.wpApiSettings && window.wpApiSettings.nonce;
    if (!nonce) throw new Error('WORDPRESS_REST_NONCE_NOT_AVAILABLE');
    function request(method, path, body) {
      const xhr = new XMLHttpRequest();
      xhr.open(method, path, false);
      xhr.setRequestHeader('X-WP-Nonce', nonce);
      if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(body === undefined ? null : JSON.stringify(body));
      if (xhr.status < 200 || xhr.status >= 300) throw new Error('WORDPRESS_REST_' + xhr.status + ':' + path);
      return JSON.parse(xhr.responseText || 'null');
    }
    const collections = ['pages','posts'], originals = [], changed = [];
    const repair = raw => String(raw || '')
      .replace(/https:\\/\\/sierramarketinginc\\.com\\/sba-bank-term-loans-for-businesses\\//gi, 'https://sierramarketinginc.com/sba-bank-term-loans-for-business/')
      .replace(/(["'])\\/sba-bank-term-loans-for-businesses\\//gi, '$1/sba-bank-term-loans-for-business/')
      .replace(/http:\\/\\/submissions@sierramarketinginc\\.com\\/?/gi, 'mailto:submissions@sierramarketinginc.com');
    try {
      for (const type of collections) {
        const rows = request('GET', '/wp-json/wp/v2/' + type + '?context=edit&per_page=100&_fields=id,slug,modified_gmt,content', undefined);
        for (const row of rows) {
          const raw = String(row.content && row.content.raw || ''), next = repair(raw);
          if (next === raw) continue;
          originals.push({type,id:row.id,slug:row.slug,modified_gmt:row.modified_gmt,content:raw});
          request('POST', '/wp-json/wp/v2/' + type + '/' + row.id, {content:next});
          changed.push({type,id:row.id,slug:row.slug,beforeLength:raw.length,afterLength:next.length});
        }
      }
      for (const item of originals) {
        const current = request('GET', '/wp-json/wp/v2/' + item.type + '/' + item.id + '?context=edit&_fields=id,content', undefined);
        const raw = String(current.content && current.content.raw || '');
        if (/sba-bank-term-loans-for-businesses\\/|http:\\/\\/submissions@sierramarketinginc\\.com/i.test(raw)) throw new Error('WORDPRESS_LINK_REPAIR_VERIFICATION_FAILED:' + item.type + ':' + item.id);
      }
      return {ok:true,changed,changedCount:changed.length,backupCount:originals.length,verified:true,rollbackPerformed:false};
    } catch (error) {
      const rollbackErrors = [];
      for (const item of originals.reverse()) {
        try { request('POST', '/wp-json/wp/v2/' + item.type + '/' + item.id, {content:item.content}); }
        catch (rollbackError) { rollbackErrors.push(item.type + ':' + item.id + ':' + String(rollbackError.message || rollbackError)); }
      }
      throw new Error('WORDPRESS_LINK_REPAIR_ROLLED_BACK:' + String(error.message || error) + (rollbackErrors.length ? ':ROLLBACK_ERRORS:' + rollbackErrors.join(',') : ''));
    }
  })()`;
  const serializedPageScript = `JSON.stringify(${pageScript})`;
  const script = `tell application "Google Chrome"\nrepeat with browserWindow in windows\nrepeat with browserTab in tabs of browserWindow\nset tabUrl to URL of browserTab\nif tabUrl starts with "https://sierramarketinginc.com/wp-admin/" then\nreturn execute browserTab javascript ${JSON.stringify(serializedPageScript)}\nend if\nend repeat\nend repeat\nreturn "WORDPRESS_ADMIN_TAB_NOT_FOUND"\nend tell`;
  await execFileAsync("open", ["-a", "Google Chrome", "https://sierramarketinginc.com/wp-admin/"], { timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 3000));
  const rawResult = await runAppleScript(script);
  if (rawResult === "WORDPRESS_ADMIN_TAB_NOT_FOUND") throw new Error("No approved Sierra WordPress admin tab");
  if (!rawResult || rawResult === "missing value") throw new Error("WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED");
  const result = JSON.parse(rawResult);
  return { wordpressLinkIntegrityRepair: result, siteOrigin: "https://sierramarketinginc.com", authority: "reversible_write", credentialsTransferred: false, formValuesCaptured: false, backupCreated: true, mutationPerformed: result.changedCount > 0, verified: result.verified === true, rollbackPerformed: result.rollbackPerformed === true };
}

async function readSeoPhase2ExecutionState(){try{return JSON.parse(await fs.readFile(SEO_PHASE2_EXECUTION_FILE,"utf8"))}catch(error){if(error?.code!=="ENOENT")throw error;return{version:1,commands:{}}}}
async function writeSeoPhase2ExecutionState(state){await fs.mkdir(HEALTH_DIR,{recursive:true,mode:0o700});const temp=SEO_PHASE2_EXECUTION_FILE+"."+process.pid+".tmp";await fs.writeFile(temp,JSON.stringify(state),{mode:0o600});await fs.rename(temp,SEO_PHASE2_EXECUTION_FILE)}
async function runWordpressAdminPageScript(pageScript){const serializedPageScript=`JSON.stringify(${pageScript})`;const script=`tell application "Google Chrome"\nrepeat with browserWindow in windows\nrepeat with browserTab in tabs of browserWindow\nset tabUrl to URL of browserTab\nif tabUrl starts with "https://sierramarketinginc.com/wp-admin/" then\nreturn execute browserTab javascript ${JSON.stringify(serializedPageScript)}\nend if\nend repeat\nend repeat\nreturn "WORDPRESS_ADMIN_TAB_NOT_FOUND"\nend tell`;await execFileAsync("open",["-a","Google Chrome","https://sierramarketinginc.com/wp-admin/"],{timeout:15000});await new Promise(resolve=>setTimeout(resolve,3000));const rawResult=await runAppleScript(script);if(rawResult==="WORDPRESS_ADMIN_TAB_NOT_FOUND")throw new Error("No approved Sierra WordPress admin tab");if(!rawResult||rawResult==="missing value")throw new Error("WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED");return JSON.parse(rawResult)}
async function executeSeoPhase2WordpressBatch(args={}){const plan=validateSeoPhase2MacRequest(args),state=await readSeoPhase2ExecutionState(),existing=state.commands?.[plan.commandId]||null;if(existing&&existing.planHash!==plan.planHash)throw new Error("SEO_PHASE2_LOCAL_RECEIPT_HASH_MISMATCH");if(existing?.verified===true&&existing?.rolledBack!==true)return{seoPhase2Execution:{...existing,duplicateReplay:true,mutationPerformed:false},authority:"reversible_write",siteOrigin:"https://sierramarketinginc.com",credentialsTransferred:false,formValuesCaptured:false};const pageScript=buildSeoPhase2WordpressPageScriptWithRollback(args),raw=await runWordpressAdminPageScript(pageScript),{publicResult,rollbackBundle}=stripRollbackBundle(raw);const receipt={commandId:plan.commandId,batch:plan.batch,planHash:plan.planHash,appliedAt:new Date().toISOString(),verified:publicResult.verified===true,mutationPerformed:Number(publicResult.changedCount||0)>0,beforeStateCaptured:true,rollbackMaterialCreated:true,publicReadbackVerified:false,rollbackBundle,rolledBack:false,internalResult:publicResult};state.version=1;state.commands={...(state.commands||{}),[plan.commandId]:receipt};await writeSeoPhase2ExecutionState(state);return{seoPhase2Execution:{...receipt,rollbackBundle:undefined},authority:"reversible_write",siteOrigin:"https://sierramarketinginc.com",credentialsTransferred:false,formValuesCaptured:false,backupCreated:true,mutationPerformed:receipt.mutationPerformed,verified:receipt.verified,rollbackPerformed:false}}
async function rollbackSeoPhase2WordpressBatch(args={}){if(args.authority!=="reversible_write"||args.operation!=="rollback_phase2_batch")throw new Error("SEO_PHASE2_ROLLBACK_AUTHORITY_REJECTED");const state=await readSeoPhase2ExecutionState(),existing=state.commands?.[String(args.commandId||"")]||null;if(!existing)throw new Error("SEO_PHASE2_ROLLBACK_RECEIPT_NOT_FOUND");if(existing.planHash!==String(args.planHash||""))throw new Error("SEO_PHASE2_ROLLBACK_PLAN_HASH_MISMATCH");if(existing.rolledBack===true)return{seoPhase2Rollback:{commandId:existing.commandId,planHash:existing.planHash,duplicateReplay:true,rollbackPerformed:true,mutationPerformed:false}};if(!Array.isArray(existing.rollbackBundle)||!existing.rollbackBundle.length){existing.rolledBack=true;existing.rolledBackAt=new Date().toISOString();state.commands[existing.commandId]=existing;await writeSeoPhase2ExecutionState(state);return{seoPhase2Rollback:{commandId:existing.commandId,planHash:existing.planHash,rollbackPerformed:false,noMutationToRollback:true,mutationPerformed:false}}}const script=buildSeoPhase2WordpressRollbackScript({commandId:existing.commandId,planHash:existing.planHash,rollbackBundle:existing.rollbackBundle}),result=await runWordpressAdminPageScript(script);existing.rolledBack=result.rollbackPerformed===true;existing.rolledBackAt=new Date().toISOString();existing.publicReadbackVerified=false;state.commands[existing.commandId]=existing;await writeSeoPhase2ExecutionState(state);return{seoPhase2Rollback:result,mutationPerformed:result.rollbackPerformed===true,authority:"reversible_write",siteOrigin:"https://sierramarketinginc.com",credentialsTransferred:false}}

async function enableWordpressApplicationPasswords(args = {}) {
  if (args.authority !== "reversible_write" || args.operation !== "enable_application_passwords") throw new Error("WORDPRESS_APP_PASSWORD_AUTHORIZATION_REJECTED");
  if (String(args.siteOrigin || "").replace(/\/$/, "") !== "https://sierramarketinginc.com") throw new Error("WORDPRESS_APP_PASSWORD_SITE_REJECTED");

  const adminBaseUrl = "https://sierramarketinginc.com/wp-admin/admin.php?page=hostinger-tools";
  const targetHash = `#georgie-app-password-${crypto.randomUUID()}`;
  const targetUrl = adminBaseUrl + targetHash;
  await execFileAsync("open", ["-a", "Google Chrome", targetUrl], { timeout: 15000 });

  const exactControlJavascript = body => `JSON.stringify((()=>{
    const expected={
      origin:'https://sierramarketinginc.com',
      pathname:'/wp-admin/admin.php',
      page:'hostinger-tools',
      hash:${JSON.stringify(targetHash)},
      section:'security',
      item:'disable application passwords',
      description:'wordpress application passwords allow users to authenticate api requests without using their main login credentials, allowing for third-party integrations.'
    };
    const norm=s=>String(s||'').replace(/\\s+/g,' ').trim().toLowerCase();
    const url=new URL(location.href);
    const pageExact=url.origin===expected.origin&&url.pathname===expected.pathname&&url.searchParams.get('page')===expected.page&&url.hash===expected.hash;
    const sections=[...document.querySelectorAll('.home-section')].filter(section=>{
      const headings=[...section.querySelectorAll('h2')].filter(el=>norm(el.textContent)===expected.section);
      return headings.length===1;
    });
    const section=sections.length===1?sections[0]:null;
    const items=section?[...section.querySelectorAll('.home-section__section-item')].filter(item=>{
      const titles=[...item.querySelectorAll('h3')].filter(el=>norm(el.textContent)===expected.item);
      const descriptions=[...item.querySelectorAll('p')].filter(el=>norm(el.textContent)===expected.description);
      return titles.length===1&&descriptions.length===1;
    }):[];
    const item=items.length===1?items[0]:null;
    const labels=item?[...item.querySelectorAll('.toggle__element-container label.toggle')]:[];
    const inputs=item?[...item.querySelectorAll('.toggle__element-container label.toggle input[type="checkbox"]')]:[];
    const label=labels.length===1?labels[0]:null;
    const input=inputs.length===1?inputs[0]:null;
    const checked=input&&typeof input.checked==='boolean'?input.checked:null;
    const classActive=label?label.classList.contains('active'):null;
    const exact=pageExact&&document.readyState==='complete'&&sections.length===1&&items.length===1&&labels.length===1&&inputs.length===1&&label&&input&&label.contains(input)&&input.disabled===true&&checked===classActive;
    ${body}
  })())`;

  const runOnTargetTab = async javascript => {
    const apple = `tell application "Google Chrome"\nset targetCount to 0\nset targetTab to missing value\nrepeat with browserWindow in windows\nrepeat with browserTab in tabs of browserWindow\nset tabUrl to URL of browserTab\nif tabUrl is ${JSON.stringify(targetUrl)} then\nset targetCount to targetCount + 1\nset targetTab to browserTab\nend if\nend repeat\nend repeat\nif targetCount is not 1 then return "WORDPRESS_SECURITY_TARGET_TAB_COUNT:" & targetCount\nreturn execute targetTab javascript ${JSON.stringify(javascript)}\nend tell`;
    return runAppleScript(apple);
  };

  const inspectJavascript = exactControlJavascript(`return {ready:document.readyState==='complete',pageExact,sectionCount:sections.length,itemCount:items.length,labelCount:labels.length,inputCount:inputs.length,checked,classActive,exact};`);
  const inspect = async (timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    let last = { exact:false, inputCount:0 };
    while (Date.now() < deadline) {
      const raw = await runOnTargetTab(inspectJavascript);
      if (!String(raw).startsWith("WORDPRESS_SECURITY_TARGET_TAB_COUNT:")) {
        try { last = JSON.parse(raw || "{}"); } catch { last = { exact:false, inputCount:0 }; }
        if (last.exact === true) return last;
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    if (last.pageExact === false) throw new Error("WORDPRESS_SECURITY_PAGE_MISMATCH");
    throw new Error(`WORDPRESS_APP_PASSWORD_CONTROL_AMBIGUOUS:${Number(last.inputCount || 0)}:${Number(last.sectionCount || 0)}:${Number(last.itemCount || 0)}`);
  };
  const waitForChecked = async (expectedChecked, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    let observed = null;
    while (Date.now() < deadline) {
      observed = await inspect(Math.min(2500, Math.max(750, deadline - Date.now())));
      if (observed.checked === expectedChecked) return observed;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`WORDPRESS_APP_PASSWORD_STATE_NOT_PROVEN:${expectedChecked}:${observed?.checked}`);
  };

  const before = await inspect();
  if (before.checked === false) return {
    wordpressApplicationPasswords: { changed:false, alreadyEnabled:true, beforeChecked:false, afterChecked:false, verified:true, rollbackPerformed:false, provider:"hostinger-tools", setting:"disableAuthenticationPassword" },
    siteOrigin:args.siteOrigin, authority:args.authority, credentialsTransferred:false, formValuesCaptured:false
  };

  const mutateJavascript = exactControlJavascript(`
    if(!exact) return {ok:false,code:'EXACT_SIGNATURE_MISMATCH'};
    if(checked!==true||classActive!==true) return {ok:false,code:'PRESTATE_MISMATCH'};
    label.click();
    return {ok:true,submitted:true,setting:'disableAuthenticationPassword'};
  `);
  const mutation = JSON.parse(await runOnTargetTab(mutateJavascript) || "{}");
  if (mutation.ok !== true) throw new Error(`WORDPRESS_APP_PASSWORD_MUTATION_REJECTED:${mutation.code || "UNKNOWN"}`);

  let after = null;
  let verificationError = null;
  try {
    await waitForChecked(false);
    await runOnTargetTab("location.reload(); 'reload-requested'");
    await new Promise(resolve => setTimeout(resolve, 1000));
    after = await waitForChecked(false);
    return {
      wordpressApplicationPasswords: { changed:true, alreadyEnabled:false, beforeChecked:true, afterChecked:false, verified:true, rollbackPerformed:false, provider:"hostinger-tools", setting:"disableAuthenticationPassword" },
      siteOrigin:args.siteOrigin, authority:args.authority, credentialsTransferred:false, formValuesCaptured:false
    };
  } catch (error) {
    verificationError = String(error?.message || error);
  }

  const rollbackJavascript = exactControlJavascript(`
    if(!exact) return {ok:false,code:'ROLLBACK_SIGNATURE_MISMATCH'};
    if(checked===true&&classActive===true) return {ok:true,alreadyRestored:true};
    if(checked!==false||classActive!==false) return {ok:false,code:'ROLLBACK_PRESTATE_MISMATCH'};
    label.click();
    return {ok:true,submitted:true};
  `);
  const rollback = JSON.parse(await runOnTargetTab(rollbackJavascript) || "{}");
  await new Promise(resolve => setTimeout(resolve, 2500));
  const rollbackAfter = rollback.ok === true ? await waitForChecked(true, 8000) : null;
  const rollbackProven = rollback.ok === true && rollbackAfter?.checked === true;
  throw new Error(`WORDPRESS_APP_PASSWORD_VERIFY_FAILED_ROLLBACK_${rollbackProven ? "PROVEN" : "FAILED"}:${verificationError}:${after?.inputCount}:${after?.checked}`);
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
    case "developer.snapshot_reconcile_restart_from_main": {
      const repo = assertDeveloperRoot(a.repo);
      if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
      const preservePaths = ["mac-agent/agent.js", "src/governed-connector.js", "src/tools.js"];
      const requestedPaths = Array.isArray(a.preservePaths) ? a.preservePaths.map(value => String(value)) : preservePaths;
      if (JSON.stringify(requestedPaths) !== JSON.stringify(preservePaths)) throw new Error("PRIMARY_MAC_SNAPSHOT_SCOPE_REJECTED");
      const expectedBlobs = a.expectedBlobs && typeof a.expectedBlobs === "object" ? a.expectedBlobs : {};
      if (preservePaths.some(file => !/^[0-9a-f]{40}$/.test(String(expectedBlobs[file] || "")))) throw new Error("PRIMARY_MAC_EXPECTED_BLOBS_REQUIRED");
      const gitBlobSha = bytes => crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");
      const before = (await runDeveloper("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
      await runDeveloper("git", ["-C", repo, "fetch", "origin", "main"], { timeout: 120000 });
      const status = await runDeveloper("git", ["-C", repo, "status", "--porcelain=v1", "--untracked-files=all"]);
      const dirtyLines = status.stdout.split("\n").filter(Boolean);
      const dirtyPaths = dirtyLines.map(line => line.slice(3));
      if (dirtyLines.some(line => line.slice(0, 2).includes("R") || line.slice(0, 2).includes("C") || line.slice(0, 2).includes("?"))) throw new Error("PRIMARY_MAC_UNSUPPORTED_DIRTY_STATE");
      if (dirtyPaths.length !== preservePaths.length || preservePaths.some(file => !dirtyPaths.includes(file))) throw new Error("PRIMARY_MAC_UNRELATED_WORK_PRESENT");
      const observedBlobs = {};
      const mainBlobs = {};
      const sourceBytes = {};
      for (const file of preservePaths) {
        const bytes = await fs.readFile(path.join(repo, file));
        sourceBytes[file] = bytes;
        observedBlobs[file] = gitBlobSha(bytes);
        if (observedBlobs[file] !== expectedBlobs[file]) throw new Error(`PRIMARY_MAC_WORKING_BLOB_MISMATCH:${file}`);
        mainBlobs[file] = (await runDeveloper("git", ["-C", repo, "rev-parse", `origin/main:${file}`])).stdout.trim();
      }
      const snapshotId = `seo-phase2-${Date.now()}-${crypto.randomUUID()}`;
      const snapshotDir = path.join(HEALTH_DIR, "recovery-snapshots", snapshotId);
      await fs.mkdir(snapshotDir, { recursive: true, mode: 0o700 });
      const filesDir = path.join(snapshotDir, "files");
      await fs.mkdir(filesDir, { recursive: true, mode: 0o700 });
      const recoveryFiles = {};
      for (const file of preservePaths) {
        const target = path.join(filesDir, file);
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.writeFile(target, sourceBytes[file], { mode: 0o600 });
        const readBack = await fs.readFile(target);
        const readBackBlob = gitBlobSha(readBack);
        if (readBackBlob !== observedBlobs[file]) throw new Error(`PRIMARY_MAC_SNAPSHOT_VERIFY_FAILED:${file}`);
        recoveryFiles[file] = { gitBlobSha: observedBlobs[file], bytes: readBack.length, relativePath: path.relative(snapshotDir, target) };
      }
      const manifest = { snapshotId, createdAt: new Date().toISOString(), repo, beforeHead: before, originMain: (await runDeveloper("git", ["-C", repo, "rev-parse", "origin/main"])).stdout.trim(), files: recoveryFiles, restoreVerified: true };
      const manifestPath = path.join(snapshotDir, "manifest.json");
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
      const manifestReadBack = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      if (manifestReadBack.snapshotId !== snapshotId || manifestReadBack.restoreVerified !== true) throw new Error("PRIMARY_MAC_MANIFEST_VERIFY_FAILED");
      await runDeveloper("git", ["-C", repo, "restore", "--source=origin/main", "--staged", "--worktree", "--", ...preservePaths]);
      const afterRestore = await runDeveloper("git", ["-C", repo, "status", "--porcelain=v1", "--untracked-files=all"]);
      if (afterRestore.stdout.trim()) throw new Error("PRIMARY_MAC_RECONCILE_NOT_CLEAN");
      await runDeveloper("git", ["-C", repo, "merge", "--ff-only", "origin/main"], { timeout: 120000 });
      const after = (await runDeveloper("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
      for (const file of preservePaths) {
        const target = path.join(repo, file);
        await fs.writeFile(target, sourceBytes[file]);
        const restored = await fs.readFile(target);
        if (gitBlobSha(restored) !== observedBlobs[file]) throw new Error(`PRIMARY_MAC_PRESERVED_RESTORE_VERIFY_FAILED:${file}`);
      }
      const preservedStatus = await runDeveloper("git", ["-C", repo, "status", "--porcelain=v1", "--untracked-files=all"]);
      const preservedDirtyPaths = preservedStatus.stdout.split("\n").filter(Boolean).map(line => line.slice(3));
      if (preservedDirtyPaths.length !== preservePaths.length || preservePaths.some(file => !preservedDirtyPaths.includes(file))) throw new Error("PRIMARY_MAC_PRESERVED_RESTORE_SCOPE_FAILED");
      const installer = path.join(repo, "mac-agent/install.sh");
      setTimeout(() => {
        const child = spawn("/bin/zsh", [installer], { cwd: repo, detached: true, stdio: "ignore", env: { ...process.env, GEORGIE_NODE_BINARY: process.execPath } });
        child.unref();
      }, 3000);
      return { repo, before, after, snapshotId, snapshotDir, manifestPath, observedBlobs, mainBlobs, restoreVerified: true, preservedWorktreeRestored: true, fastForwardOnly: true, restartScheduled: true, restartDelayMs: 3000, wordpressMutation: false };
    }
    case "developer.update_restart_from_main": {
      const repo = assertDeveloperRoot(a.repo);
      if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
      const before = await runDeveloper("git", ["-C", repo, "rev-parse", "HEAD"]);
      await runDeveloper("git", ["-C", repo, "fetch", "origin", "main"], { timeout: 120000 });
      let status = await runDeveloper("git", ["-C", repo, "status", "--porcelain"]);
      if (status.stdout.trim() === "M package-lock.json") {
        const lockDiff = await runDeveloper("git", ["-C", repo, "diff", "--unified=0", "--", "package-lock.json"]);
        const changed = lockDiff.stdout.split("\n").filter(line => /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line));
        const generatedVersionOnly = changed.length > 0 && changed.length <= 4 && changed.every(line => /^[+-]\s+"version":\s+"\d+\.\d+\.\d+",?$/.test(line));
        if (generatedVersionOnly) {
          await runDeveloper("git", ["-C", repo, "restore", "--", "package-lock.json"]);
          status = await runDeveloper("git", ["-C", repo, "status", "--porcelain"]);
        }
      }
      if (status.stdout.trim()) {
        const remoteIdentical = await reconcileRemoteIdenticalDirtyPaths({ repo, run: runDeveloper });
        status = await runDeveloper("git", ["-C", repo, "status", "--porcelain"]);
        if (!remoteIdentical.reconciled || status.stdout.trim()) throw new Error("PRIMARY_MAC_REPO_DIRTY");
      }
      await runDeveloper("git", ["-C", repo, "merge", "--ff-only", "origin/main"], { timeout: 120000 });
      const after = await runDeveloper("git", ["-C", repo, "rev-parse", "HEAD"]);
      const installer = path.join(repo, "mac-agent/install.sh");
      setTimeout(() => {
        const child = spawn("/bin/zsh", [installer], { cwd: repo, detached: true, stdio: "ignore", env: { ...process.env, GEORGIE_NODE_BINARY: process.execPath } });
        child.unref();
      }, 3000);
      return { repo, before: before.stdout.trim(), after: after.stdout.trim(), fastForwardOnly: true, restartScheduled: true, restartDelayMs: 3000 };
    }
    case "developer.install_neo_preload": {
      const repo = assertDeveloperRoot(a.repo);
      if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
      const extension = path.join(repo, "mac-agent/neo-preload-extension");
      const manifestText = await fs.readFile(path.join(extension, "manifest.json"), "utf8");
      const manifest = JSON.parse(manifestText);
      if (manifest.manifest_version !== 3 || manifest.background?.service_worker !== "background.js" || JSON.stringify(manifest.permissions) !== JSON.stringify(["debugger"]) || JSON.stringify(manifest.host_permissions) !== JSON.stringify(["https://app.neo.space/*"])) throw new Error("NEO_PRELOAD_MANIFEST_SCOPE_REJECTED");
      const preloadText = await fs.readFile(path.join(extension, "preload.js"), "utf8");
      if (/document\.cookie|localStorage|getItem\(|sessionStorage|chrome\.storage|request\.headers|request\.body|init\.body/i.test(preloadText)) throw new Error("NEO_PRELOAD_PRIVACY_GUARD_REJECTED");
      const manifestHash = crypto.createHash("sha256").update(manifestText).digest("hex");
      const preloadHash = crypto.createHash("sha256").update(preloadText).digest("hex");
      await runDeveloper("/usr/bin/osascript", ["-e", "tell application \"Google Chrome\" to quit"], { timeout: 15000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 3000));
      await runDeveloper("/usr/bin/open", ["-a", "Google Chrome", "--args", `--load-extension=${extension}`, "https://app.neo.space/mail/"], { timeout: 15000 });
      await new Promise(resolve => setTimeout(resolve, 4000));
      const reloadScript = `tell application "Google Chrome"\nrepeat with browserWindow in windows\nrepeat with browserTab in tabs of browserWindow\nset tabUrl to URL of browserTab\nif tabUrl starts with "https://app.neo.space/" or tabUrl is "https://app.neo.space" then\nreload browserTab\nreturn "RELOADED"\nend if\nend repeat\nend repeat\nreturn "NEO_TAB_NOT_FOUND"\nend tell`;
      const reload = await runDeveloper("/usr/bin/osascript", ["-e", reloadScript], { timeout: 15000 });
      if (reload.stdout.trim() !== "RELOADED") throw new Error("NEO_POST_REGISTRATION_RELOAD_FAILED");
      return { repo, extension, manifestVersion: manifest.version, manifestHash, preloadHash, executionBridge: "chrome_debugger_local_relay", runAt: "document_start", world: "ISOLATED", matches: manifest.host_permissions, chromeRelaunched: true, postRegistrationReload: true, credentialsTransferred: false };
    }
    case "developer.inspect_neo_preload": {
      const repo = assertDeveloperRoot(a.repo);
      if (repo !== "/Users/mac/Georgie") throw new Error("PRIMARY_MAC_REPO_NOT_ALLOWLISTED");
      const script = `JSON.stringify((()=>{const p=window.__georgieNeoPreload||null;let extensionDiagnostic=null;try{extensionDiagnostic=JSON.parse(document.documentElement.dataset.georgieNeoExtensionDiagnostic||"null")}catch{}return{origin:location.origin,loaded:Boolean(p&&p.hookVersion),hookVersion:p?.hookVersion||null,preNavigation:p?.preNavigation===true,extensionDiagnostic,accountBindings:(p?.accountBindings||[]).map(x=>({email:x.email,accountIdPresent:Boolean(x.accountId),emailField:x.emailField,idField:x.idField,sourceOrigin:x.sourceOrigin,sourceEndpoint:x.sourceEndpoint,sourceMethod:x.sourceMethod})).slice(0,20),sources:(p?.sources||[]).slice(0,40),mutationObserved:p?.mailboxMutation===true,credentialsTransferred:false,requestBodiesCaptured:false}})())`;
      const appleScript = `tell application "Google Chrome"\nrepeat with browserWindow in windows\nrepeat with browserTab in tabs of browserWindow\nset tabUrl to URL of browserTab\nif tabUrl starts with "https://app.neo.space/" or tabUrl is "https://app.neo.space" then\nreturn execute browserTab javascript ${JSON.stringify(script)}\nend if\nend repeat\nend repeat\nreturn "{\\\"diagnostic\\\":\\\"NEO_TAB_NOT_FOUND\\\"}"\nend tell`;
      const output = await runDeveloper("/usr/bin/osascript", ["-e", appleScript], { timeout: 15000 });
      const health = JSON.parse(output.stdout.trim());
      const requested = (Array.isArray(a.mailboxes) ? a.mailboxes : []).map(value => String(value).trim().toLowerCase());
      const bound = new Set((health.accountBindings || []).filter(item => item.accountIdPresent).map(item => String(item.email).trim().toLowerCase()));
      const failures = [];
      if (health.diagnostic) failures.push(health.diagnostic);
      if (health.origin !== "https://app.neo.space") failures.push("NEO_ORIGIN_NOT_PROVEN");
      if (!health.loaded) failures.push("NEO_PRELOAD_NOT_LOADED");
      if (!health.preNavigation) failures.push("NEO_PRE_NAVIGATION_NOT_PROVEN");
      if (health.extensionDiagnostic?.ok === false) failures.push(`NEO_EXTENSION_REGISTRATION_ERROR:${health.extensionDiagnostic.code||"UNKNOWN"}:${String(health.extensionDiagnostic.message||"no_detail").replace(/[\r\n,]/g," ").slice(0,240)}`);
      if (!health.extensionDiagnostic) failures.push("NEO_EXTENSION_DIAGNOSTIC_NOT_PRESENT");
      if (health.mutationObserved) failures.push("NEO_MUTATION_OBSERVED");
      for (const mailbox of requested) if (!bound.has(mailbox)) failures.push(`NEO_ACCOUNT_BINDING_NOT_PROVEN:${mailbox}`);
      if (failures.length) throw new Error(`NEO_PRELOAD_HEALTH_NOT_PROVEN:${failures.join(",")}`);
      return { repo, health, mailboxContentAccessed: false, credentialsTransferred: false, mutationPerformed: false };
    }
    case "mailbox.neo_cdp_verify_session": {
      if (a.authority !== "read_only") throw new Error("NEO_CDP_AUTHORITY_REJECTED");
      const requested = (Array.isArray(a.mailboxes) ? a.mailboxes : []).map(value => String(value).trim().toLowerCase());
      if (!requested.length || requested.some(value => !/^[^@\s]+@sierramarketinginc\.com$/.test(value))) throw new Error("NEO_DEBUGGER_MAILBOX_SCOPE_REJECTED");
      const requestId = crypto.randomUUID();
      const browserScript = `JSON.stringify((()=>{const root=document.documentElement;root.dataset.georgieNeoDebuggerRequest=${JSON.stringify(JSON.stringify({id:requestId,type:"verify_session",mailboxes:requested}))};return{queued:true}})())`;
      const publishScript = `tell application "Google Chrome"\nrepeat with browserWindow in windows\nrepeat with browserTab in tabs of browserWindow\nset tabUrl to URL of browserTab\nif tabUrl starts with "https://app.neo.space/" then\nexecute browserTab javascript ${JSON.stringify(browserScript)}\ndelay 2\nreturn execute browserTab javascript "document.documentElement.dataset.georgieNeoDebuggerResult || ''"\nend if\nend repeat\nend repeat\nreturn ""\nend tell`;
      const output = await runDeveloper("/usr/bin/osascript", ["-e", publishScript], { timeout: 15000 });
      if (!output.stdout.trim()) throw new Error("NEO_DEBUGGER_RELAY_NO_RESULT");
      const result = JSON.parse(output.stdout.trim());
      if (result.id !== requestId || result.ok !== true) throw new Error(`${result.code||"NEO_DEBUGGER_SESSION_NOT_VERIFIED"}:${result.message||"no_detail"}`);
      return { provider: result.provider, origin: result.origin, bindings: result.bindings, authority: "read_only", messageContentAccessed: false, credentialsTransferred: false, mutationPerformed: false };
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
    case "roblox.install_rojo_and_build": {
      const pinned=await installPinnedRojo();
      const result=await buildRobloxPrototype(a);
      return{...result,rojoInstalled:pinned.installed,rojoPath:pinned.path,rojoVersion:pinned.version,rojoArchiveSha256:pinned.archiveSha256,rojoBinarySha256:pinned.binarySha256,rojoReleaseUrl:ROJO_RELEASE.url};
    }
    case "roblox.prototype_build":
      return buildRobloxPrototype(a);
    case "roblox.play_test_validate":
      return playTestRobloxPrototype(a);
    case "screen.capture": {
      const target = path.join(os.tmpdir(), `georgie-screen-${Date.now()}.png`);
      await execFileAsync("screencapture", ["-x", target], { timeout: 15000 });
      const bytes = await fs.readFile(target);
      await fs.unlink(target).catch(() => {});
      return { mimeType: "image/png", base64: bytes.toString("base64").slice(0, 8_000_000) };
    }
    case "browser.inspect_tabs":
      return inspectBrowserTabs({ includeContent: a.includeContent !== false });
    case "browser.wordpress_hostinger_inspect":
      return inspectGovernedWordpressSession(a);
    case "browser.wordpress_link_integrity_repair":
      return repairWordpressLinkIntegrity(a);
    case "browser.wordpress_phase2_batch":
      return executeSeoPhase2WordpressBatch(a);
    case "browser.wordpress_phase2_rollback":
      return rollbackSeoPhase2WordpressBatch(a);
    case "browser.wordpress_enable_application_passwords":
      return enableWordpressApplicationPasswords(a);
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
    const payload = await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs?limit=5&agentVersion=${encodeURIComponent(AGENT_VERSION)}`);
    for (const job of payload.jobs || []) {
      let keepalive=null;
      try {
        if(["roblox.install_rojo_and_build","roblox.play_test_validate"].includes(job.action))keepalive=setInterval(()=>api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs/${encodeURIComponent(job.id)}/checkpoint`,{method:"POST",body:JSON.stringify({nextStep:Number(job.workflowCheckpoint?.nextStep||0),stepId:"long-running-keepalive",receipt:{stepId:"long-running-keepalive",at:new Date().toISOString()}})}).catch(()=>{}),30_000);
        const result = await execute(job);
        await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ result }) });
      } catch (error) {
        await api(`/api/mac/${encodeURIComponent(DEVICE_ID)}/jobs/${job.id}/complete`, { method: "POST", body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) });
      } finally {if(keepalive)clearInterval(keepalive);}
    }
    await writeDaemonHealth({ lastPollOk: true });
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
