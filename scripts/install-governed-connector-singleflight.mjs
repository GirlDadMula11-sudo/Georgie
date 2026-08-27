import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "../src/governed-connector.js");
let source = fs.readFileSync(file, "utf8");

const singleFlightInstalled = source.includes("const scheduledRuns = new Set();");

const anchor = '  function schedule(userId,command){setImmediate(()=>run(userId,command).catch(error=>console.error(`[Georgie] connector background execution failed ${command.id}:`,error instanceof Error?error.stack||error.message:error)));}';
if (!source.includes(anchor)) throw new Error("Governed connector schedule anchor not found; refusing blind patch");

const replacement = `  const scheduledRuns = new Set();\n  function schedule(userId,command){\n    const key=\`${'${String(userId)}:${command.id}'}\`;\n    if(scheduledRuns.has(key))return false;\n    scheduledRuns.add(key);\n    setImmediate(()=>run(userId,command)\n      .catch(error=>console.error(\`[Georgie] connector background execution failed ${'${command.id}'}:\`,error instanceof Error?error.stack||error.message:error))\n      .finally(()=>scheduledRuns.delete(key)));\n    return true;\n  }`;
if (!singleFlightInstalled) {
  if (!source.includes(anchor)) throw new Error("Governed connector schedule anchor not found; refusing blind patch");
  source = source.replace(anchor, replacement);
}
const completionAnchor = 'const blocked=terminalState==="blocked"||result?.outcome?.terminalState==="blocked";';
const completionFence = 'const failedActions=Array.isArray(result?.actions)&&result.actions.length>0&&result.actions.every(action=>action?.ok===false); const blocked=terminalState==="blocked"||result?.outcome?.terminalState==="blocked"||failedActions;';
if (!source.includes("failedActions=Array.isArray(result?.actions)")) {
  if (!source.includes(completionAnchor)) throw new Error("Governed connector completion anchor not found; refusing blind patch");
  source = source.replace(completionAnchor, completionFence);
}
fs.writeFileSync(file, source);
console.log("[Georgie] Governed connector single-flight and truthful completion fences verified.");
