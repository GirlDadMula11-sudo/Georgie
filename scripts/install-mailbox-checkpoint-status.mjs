import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(__dirname, "../src/governed-connector.js");
let source = fs.readFileSync(file, "utf8");

const marker = "SIERRA_MAILBOX_CHECKPOINT_STATUS_V1";
const checkpointAlreadyInstalled = source.includes(marker) || (
  source.includes('"sierra.mailbox_evidence.project"') &&
  source.includes('"checkpoint_status"') &&
  source.includes('route.operation === "checkpoint_status"') &&
  (source.includes("authorityByOperation") || source.includes("operationAuthorities"))
);
if (checkpointAlreadyInstalled) {
  console.log("[Georgie] Sierra mailbox checkpoint/status capability already installed.");
  process.exit(0);
}

const capabilityAnchor = `  "sierra.mailbox_evidence.project": Object.freeze({\n    targetDevice: "server",\n    authority: "evidence_write",\n    operations: new Set(["project_immutable_receipts"]),\n    prohibitedRoutes: new Set(["email.send", "smtp", "mailbox.write", "external.notification", "lender.submit"])\n  }),`;
const capabilityReplacement = `  "sierra.mailbox_evidence.project": Object.freeze({\n    targetDevice: "server",\n    authority: "evidence_write",\n    operationAuthorities: Object.freeze({ project_immutable_receipts: "evidence_write", checkpoint_status: "read_only" }),\n    operations: new Set(["project_immutable_receipts", "checkpoint_status"]),\n    prohibitedRoutes: new Set(["email.send", "smtp", "mailbox.write", "external.notification", "lender.submit"])\n  }),`;
if (!source.includes(capabilityAnchor)) throw new Error("Sierra mailbox capability anchor not found; refusing blind patch");
source = source.replace(capabilityAnchor, capabilityReplacement);

const validatorAnchor = `    if (targetDevice !== contract.targetDevice) throw new Error(\`CAPABILITY_TARGET_MISMATCH: \${capability} requires \${contract.targetDevice}\`);\n    if (authority !== contract.authority) throw new Error(\`CAPABILITY_AUTHORITY_MISMATCH: \${capability} requires \${contract.authority}\`);\n    if (!contract.operations.has(operation)) throw new Error(\`UNSUPPORTED_OPERATION: \${capability}/\${operation}\`);`;
const validatorReplacement = `    if (targetDevice !== contract.targetDevice) throw new Error(\`CAPABILITY_TARGET_MISMATCH: \${capability} requires \${contract.targetDevice}\`);\n    if (!contract.operations.has(operation)) throw new Error(\`UNSUPPORTED_OPERATION: \${capability}/\${operation}\`);\n    const requiredAuthority = contract.operationAuthorities?.[operation] || contract.authority;\n    if (authority !== requiredAuthority) throw new Error(\`CAPABILITY_AUTHORITY_MISMATCH: \${capability}/\${operation} requires \${requiredAuthority}\`);`;
if (!source.includes(validatorAnchor)) throw new Error("Capability authority validator anchor not found; refusing blind patch");
source = source.replace(validatorAnchor, validatorReplacement);

const executionAnchor = `  if (route.capability === "sierra.mailbox_evidence.project") {\n    const receiptIds = [...new Set((command.metadata?.receipt_ids || []).map(value => clean(value, 200)))];`;
const executionReplacement = `  if (route.capability === "sierra.mailbox_evidence.project") {\n    // ${marker}: objective-scoped, non-mutating durable checkpoint inspection.\n    if (route.operation === "checkpoint_status") {\n      const state = normalizeConnectorState(await readCloudState(String(userId), NS, baseState()));\n      const objectiveCommands = state.commands.filter(item => item?.objectiveId === route.objective_id);\n      const objectiveReceipts = state.receipts.filter(item => item?.objectiveId === route.objective_id);\n      const objectiveLeases = state.leases.filter(item => item?.objectiveId === route.objective_id);\n      const orderedCommands = [...objectiveCommands].sort((a, b) => String(a?.updatedAt || a?.createdAt || "").localeCompare(String(b?.updatedAt || b?.createdAt || "")));\n      const latest = orderedCommands.at(-1) || null;\n      const candidates = [...objectiveReceipts].reverse().map(item => item?.payload?.resultSummary?.cursors || item?.payload?.resultSummary?.cursor || item?.payload?.result?.cursors || item?.payload?.result?.cursor).filter(value => value && typeof value === "object");\n      if (latest?.result?.cursors && typeof latest.result.cursors === "object") candidates.unshift(latest.result.cursors);\n      else if (latest?.result?.cursor && typeof latest.result.cursor === "object") candidates.unshift(latest.result.cursor);\n      const cursors = candidates[0] || {};\n      const exhaustion = Object.fromEntries(Object.entries(cursors).map(([mailbox, value]) => [mailbox, Boolean(value?.exhausted)]));\n      return {\n        terminalState: "completed", completed: true, route,\n        checkpoint: {\n          objectiveId: route.objective_id,\n          commandCount: objectiveCommands.length,\n          receiptCount: objectiveReceipts.length,\n          leaseCount: objectiveLeases.length,\n          latestCommand: latest ? { id: latest.id, status: latest.status || null, createdAt: latest.createdAt || null, updatedAt: latest.updatedAt || null } : null,\n          cursors, exhaustion, stateUpdatedAt: state.updatedAt || null\n        },\n        evidence: [], errors: [], mailboxMutation: false, markSeen: false, projectionMutation: false, notificationMutation: false, prohibitedTool: "email.send"\n      };\n    }\n    const receiptIds = [...new Set((command.metadata?.receipt_ids || []).map(value => clean(value, 200)))];`;
if (!source.includes(executionAnchor)) throw new Error("Sierra mailbox execution anchor not found; refusing blind patch");
source = source.replace(executionAnchor, executionReplacement);

fs.writeFileSync(file, source);
console.log("[Georgie] Installed read-only Sierra mailbox checkpoint/status capability.");
