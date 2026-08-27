import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
function patchFile(relativePath, transforms) {
  const target = path.join(root, relativePath);
  let source = fs.readFileSync(target, "utf8");
  let next = source;
  for (const transform of transforms) next = transform(next);
  if (next !== source) fs.writeFileSync(target, next);
  return next;
}

patchFile("src/objective-worker.js", [
  source => source.includes('from "./operator-reliability-v2.js"') ? source : source.replace('import { executeTool } from "./tools.js";', 'import { executeTool } from "./tools.js";\nimport { recoveryDecision, resetStepAttempts, reliabilityReceipt } from "./operator-reliability-v2.js";'),
  source => source.includes('attemptsByStep: {}') ? source : source.replace('steps, stepIndex: 0, attempts: 0, maxAttempts:', 'steps, stepIndex: 0, attempts: 0, attemptsByStep: {}, recoveryTrail: [], maxAttempts:'),
  source => source.replace(
    /objective\.attempts = Number\(objective\.attempts \|\| 0\) \+ 1;(?: objective\.attemptsByStep = objective\.attemptsByStep \|\| \{\}; objective\.recoveryTrail = Array\.isArray\(objective\.recoveryTrail\) \? objective\.recoveryTrail : \[\];)*/,
    'objective.attempts = Number(objective.attempts || 0) + 1; objective.attemptsByStep = objective.attemptsByStep || {}; objective.recoveryTrail = Array.isArray(objective.recoveryTrail) ? objective.recoveryTrail : [];'
  ),
  source => {
    const oldBlock = `      objective.lease = null;\n      objective.status = execution.approvalRequired ? "waiting_approval" : (objective.attempts >= objective.maxAttempts ? "blocked" : "recovering");\n      objective.nextRunAt = new Date(Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(objective.attempts, 6))).toISOString();\n      objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: objective.status, lastError: clean(execution.error || execution.blockedBy || "execution_failed", 1000) };`;
    const newBlock = `      objective.lease = null;\n      const recovery = recoveryDecision({ stepId: step.id, attemptsByStep: objective.attemptsByStep, maxAttempts: objective.maxAttempts, error: execution.error || execution.blockedBy || "execution_failed", approvalRequired: execution.approvalRequired });\n      objective.attemptsByStep = { ...objective.attemptsByStep, [step.id]: recovery.attempts };\n      objective.recoveryTrail = [...objective.recoveryTrail, recovery.recoveryEvent].slice(-100);\n      objective.status = recovery.status;\n      objective.nextRunAt = recovery.nextRunAt || objective.nextRunAt;\n      objective.checkpoint = { ...objective.checkpoint, lastStepId: step.id, lastStatus: objective.status, lastError: clean(execution.error || execution.blockedBy || "execution_failed", 1000), lastFailureClass: recovery.failureClass, stepAttempt: recovery.attempts };`;
    return source.includes(oldBlock) ? source.replace(oldBlock, newBlock) : source;
  },
  source => {
    const old = 'objective.stepIndex += 1; objective.lease = null; objective.attempts = 0;';
    const replacement = 'objective.stepIndex += 1; objective.lease = null; objective.attempts = 0; objective.attemptsByStep = resetStepAttempts(objective.attemptsByStep, step.id);';
    return source.includes(replacement) ? source : source.replace(old, replacement);
  },
  source => {
    const old = 'await persistObjective(userId, objective); return { status: "verified", objectiveId: objective.id };';
    const replacement = 'await persistObjective(userId, objective); return { status: "verified", objectiveId: objective.id, receipt: reliabilityReceipt({ objective, terminalStatus: "verified", evidence: objective.evidence }) };';
    return source.includes(replacement) ? source : source.replace(old, replacement);
  }
]);

patchFile("src/memory.js", [
  source => source.includes('from "./operator-reliability-v2.js"') ? source : source.replace('import crypto from "node:crypto";', 'import crypto from "node:crypto";\nimport { scoreMemoryCandidate, memoryContextLine } from "./operator-reliability-v2.js";'),
  source => source.replace(/function scoreMemory\(memory,queryTokens\)\{[^\n]+\}/, 'function scoreMemory(memory,queryTokens){return scoreMemoryCandidate(memory,[...queryTokens].join(" "));}'),
  source => {
    const old = 'export async function addMemory({userId="primary",text,category="fact",importance=0.5,tags=[],source="conversation"})';
    const replacement = 'export async function addMemory({userId="primary",text,category="fact",importance=0.5,tags=[],source="conversation",sourceType=null,sourceRef=null,confidence=0.7,status="active",observedAt=null})';
    return source.includes(replacement) ? source : source.replace(old, replacement);
  },
  source => source.replace('const memory={id:crypto.randomUUID(),userId:id,text:normalized,category:String(category||"fact").slice(0,50),importance:Math.max(0,Math.min(1,Number(importance)||0.5)),tags:[...new Set(tags.map(String))].slice(0,12),source,createdAt:now(),updatedAt:now()};', 'const memory={id:crypto.randomUUID(),userId:id,text:normalized,category:String(category||"fact").slice(0,50),importance:Math.max(0,Math.min(1,Number(importance)||0.5)),tags:[...new Set(tags.map(String))].slice(0,12),source,sourceType:sourceType||source,sourceRef:sourceRef?String(sourceRef).slice(0,500):null,confidence:Math.max(0,Math.min(1,Number(confidence)||0.7)),status:["active","verified","conflicted","superseded"].includes(status)?status:"active",observedAt:observedAt||now(),createdAt:now(),updatedAt:now()};'),
  source => source.replace('const memoryText=memories.map(memory=>`- [${memory.category}] ${memory.text}`).join("\\n");', 'const memoryText=memories.map(memory=>memoryContextLine(memory)).join("\\n");')
]);

patchFile("src/evaluation.js", [
  source => source.includes('resumeFidelity:') ? source : source.replace('actionSuccess: input.toolCount ? Boolean(input.actionSuccess) : null', 'actionSuccess: input.toolCount ? Boolean(input.actionSuccess) : null,\n    resumeFidelity: input.resumeFidelity == null ? null : Boolean(input.resumeFidelity),\n    routingCorrect: input.routingCorrect == null ? null : Boolean(input.routingCorrect),\n    terminalReceiptVerified: input.terminalReceiptVerified == null ? null : Boolean(input.terminalReceiptVerified)'),
  source => source.includes('resumeFidelityRate:') ? source : source.replace('actionSuccessRate: actionItems.length ? Number((actionItems.filter((item) => item.actionSuccess).length / actionItems.length).toFixed(3)) : null,', 'actionSuccessRate: actionItems.length ? Number((actionItems.filter((item) => item.actionSuccess).length / actionItems.length).toFixed(3)) : null,\n    resumeFidelityRate: items.filter(i=>i.resumeFidelity!==null&&i.resumeFidelity!==undefined).length ? Number((items.filter(i=>i.resumeFidelity===true).length / items.filter(i=>i.resumeFidelity!==null&&i.resumeFidelity!==undefined).length).toFixed(3)) : null,\n    routingCorrectnessRate: items.filter(i=>i.routingCorrect!==null&&i.routingCorrect!==undefined).length ? Number((items.filter(i=>i.routingCorrect===true).length / items.filter(i=>i.routingCorrect!==null&&i.routingCorrect!==undefined).length).toFixed(3)) : null,\n    terminalReceiptVerificationRate: items.filter(i=>i.terminalReceiptVerified!==null&&i.terminalReceiptVerified!==undefined).length ? Number((items.filter(i=>i.terminalReceiptVerified===true).length / items.filter(i=>i.terminalReceiptVerified!==null&&i.terminalReceiptVerified!==undefined).length).toFixed(3)) : null,')
]);

for (const file of ["src/objective-worker.js","src/memory.js","src/evaluation.js"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (!source.includes("operator-reliability-v2") && file !== "src/evaluation.js") throw new Error(`operator reliability v2 verification failed: ${file}`);
}
console.log("[Georgie] operator reliability v2 installed");
