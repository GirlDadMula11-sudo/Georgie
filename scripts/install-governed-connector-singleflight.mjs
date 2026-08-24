import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "../src/governed-connector.js");
let source = fs.readFileSync(file, "utf8");

if (source.includes("const scheduledRuns = new Set();")) {
  console.log("[Georgie] Governed connector single-flight scheduler already installed.");
  process.exit(0);
}

const anchor = '  function schedule(userId,command){setImmediate(()=>run(userId,command).catch(error=>console.error(`[Georgie] connector background execution failed ${command.id}:`,error instanceof Error?error.stack||error.message:error)));}';
if (!source.includes(anchor)) throw new Error("Governed connector schedule anchor not found; refusing blind patch");

const replacement = `  const scheduledRuns = new Set();\n  function schedule(userId,command){\n    const key=\`${'${String(userId)}:${command.id}'}\`;\n    if(scheduledRuns.has(key))return false;\n    scheduledRuns.add(key);\n    setImmediate(()=>run(userId,command)\n      .catch(error=>console.error(\`[Georgie] connector background execution failed ${'${command.id}'}:\`,error instanceof Error?error.stack||error.message:error))\n      .finally(()=>scheduledRuns.delete(key)));\n    return true;\n  }`;
source = source.replace(anchor, replacement);
fs.writeFileSync(file, source);
console.log("[Georgie] Installed governed connector single-flight scheduler.");
