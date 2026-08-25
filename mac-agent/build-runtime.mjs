import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const sourcePath = path.join(here, "agent.js");
const runtimePath = path.join(here, "agent.runtime.js");
const handlerPath = path.join(repo, "scripts", "templates", "wordpress-app-password-handler.txt");
const expectedVersion = String(process.argv[2] || "").trim();

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
  throw new Error("A semantic agent version is required");
}

let runtime = fs.readFileSync(sourcePath, "utf8");
const handler = fs.readFileSync(handlerPath, "utf8").trimEnd() + "\n\n";

runtime = runtime.replace(
  /const AGENT_VERSION = "\d+\.\d+\.\d+";/,
  `const AGENT_VERSION = ${JSON.stringify(expectedVersion)};`
);
if (!runtime.includes(`const AGENT_VERSION = ${JSON.stringify(expectedVersion)};`)) {
  throw new Error("Mac runtime version replacement failed");
}

if (!runtime.includes("async function enableWordpressApplicationPasswords")) {
  const functionAnchor = "async function waitForAppProcess(app, timeoutMs = 8000) {";
  if (!runtime.includes(functionAnchor)) throw new Error("WordPress handler function anchor missing");
  runtime = runtime.replace(functionAnchor, handler + functionAnchor);
}

if (!runtime.includes('case "browser.wordpress_enable_application_passwords"')) {
  const switchAnchor = '    case "browser.wordpress_link_integrity_repair":\n      return repairWordpressLinkIntegrity(a);';
  if (!runtime.includes(switchAnchor)) throw new Error("WordPress handler switch anchor missing");
  runtime = runtime.replace(
    switchAnchor,
    `${switchAnchor}\n    case "browser.wordpress_enable_application_passwords":\n      return enableWordpressApplicationPasswords(a);`
  );
}

for (const invariant of [
  "async function enableWordpressApplicationPasswords",
  'case "browser.wordpress_enable_application_passwords"',
  "WORDPRESS_APP_PASSWORD_AUTHORIZATION_REJECTED",
  "WORDPRESS_APP_PASSWORD_CONTROL_AMBIGUOUS"
]) {
  if (!runtime.includes(invariant)) throw new Error(`Generated Mac runtime missing invariant: ${invariant}`);
}

fs.writeFileSync(runtimePath, runtime, { mode: 0o600 });
execFileSync(process.execPath, ["--check", runtimePath], { stdio: "inherit" });
console.log(JSON.stringify({ ok: true, runtimePath, expectedVersion, wordpressApplicationPasswordCapability: true }));
