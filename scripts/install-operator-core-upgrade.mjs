import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fastIntentsPath = path.join(root, "src", "fast-intents.js");
const source = fs.readFileSync(fastIntentsPath, "utf8");

const legacy = `  if (/\\b(?:analy[sz]e|audit|diagnose|review|inspect)\\b/.test(lower) && /\\b(?:georgie|repo|repository|codebase|architecture)\\b/.test(lower) && /\\b(?:reliability|silent|working|tool|continuity|completion|failure|weakness|crash)\\b/.test(lower)) return [{tool:\"developer.search\",args:{repo:null,query:\"completeTurnV2|respond/stream|sendTextTurn|isBusy|appendSessionTurn|executePlannedActions|verifiedDirectResponse|planActions|queueMacAndWait|recordTurnEvaluation|restoreSession|backgroundLearn\"}}];`;

const upgraded = `  // Operator-core upgrade: only take the deterministic developer.search shortcut when the\n  // user explicitly asks to search/inspect source. Broad requests to repair, strengthen,\n  // upgrade, sophisticate, or improve Georgie must reach the normal planner so it can\n  // decompose the objective, select multiple tools, verify work, recover, and continue.\n  const explicitDeveloperSourceSearch = /\\b(?:search|grep|find|locate|inspect source|inspect code|search source|search code)\\b/.test(lower)\n    && /\\b(?:georgie|repo|repository|codebase|architecture)\\b/.test(lower)\n    && /\\b(?:reliability|silent|working|tool|continuity|completion|failure|weakness|crash)\\b/.test(lower);\n  if (explicitDeveloperSourceSearch) return [{tool:\"developer.search\",args:{repo:null,query:\"completeTurnV2|respond/stream|sendTextTurn|isBusy|appendSessionTurn|executePlannedActions|verifiedDirectResponse|planActions|queueMacAndWait|recordTurnEvaluation|restoreSession|backgroundLearn\"}}];`;

let next = source;
if (next.includes(legacy)) {
  next = next.replace(legacy, upgraded);
} else if (!next.includes("const explicitDeveloperSourceSearch =")) {
  throw new Error("operator-core upgrade refused: expected fast-intent guard not found");
}

if (next !== source) fs.writeFileSync(fastIntentsPath, next);

const verification = fs.readFileSync(fastIntentsPath, "utf8");
if (!verification.includes("const explicitDeveloperSourceSearch =")) {
  throw new Error("operator-core upgrade verification failed");
}

console.log("[Georgie] operator-core routing upgrade installed");
