import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "../src/governed-connector.js");
let source = fs.readFileSync(file, "utf8");

if (!source.includes("const scheduledRuns = new Set();")) {
  const anchor = '  function schedule(userId,command){setImmediate(()=>run(userId,command).catch(error=>console.error(\`[Georgie] connector background execution failed \${command.id}:\`,error instanceof Error?error.stack||error.message:error)));}';
  if (!source.includes(anchor)) throw new Error("Governed connector schedule anchor not found; refusing blind patch");
  const replacement = [
    "  const scheduledRuns = new Set();",
    "  function schedule(userId,command){",
    "    const key=\`\${String(userId)}:\${command.id}\`;",
    "    if(scheduledRuns.has(key))return false;",
    "    scheduledRuns.add(key);",
    "    setImmediate(()=>run(userId,command)",
    "      .catch(error=>console.error(\`[Georgie] connector background execution failed \${command.id}:\`,error instanceof Error?error.stack||error.message:error))",
    "      .finally(()=>scheduledRuns.delete(key)));",
    "    return true;",
    "  }"
  ].join("\\n");
  source = source.replace(anchor, replacement);
}

if (!source.includes("failedActions=Array.isArray(result?.actions)")) {
  const anchor = 'const blocked=terminalState==="blocked"||result?.outcome?.terminalState==="blocked";';
  const replacement = 'const failedActions=Array.isArray(result?.actions)&&result.actions.length>0&&result.actions.every(action=>action?.ok===false); const blocked=terminalState==="blocked"||result?.outcome?.terminalState==="blocked"||failedActions;';
  if (!source.includes(anchor)) throw new Error("Governed connector completion anchor not found; refusing blind patch");
  source = source.replace(anchor, replacement);
}

fs.writeFileSync(file, source);
console.log("[Georgie] Governed connector single-flight and truthful completion fences verified.");
