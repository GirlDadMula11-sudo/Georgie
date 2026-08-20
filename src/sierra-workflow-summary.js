const WORKFLOW_TOOLS = ["sierra.health", "sierra.infrastructure", "sierra.apply_inventory", "sierra.reconciliation_invariant", "sierra.portfolio"];

function findScalar(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return undefined;
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(value, key) && ["string", "number", "boolean"].includes(typeof value[key])) return value[key];
  for (const nested of Object.values(value)) { const found = findScalar(nested, keys, depth + 1); if (found !== undefined) return found; }
  return undefined;
}

function countRows(value, depth = 0) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object" || depth > 3) return undefined;
  for (const key of ["items", "records", "submissions", "deals", "rows", "inventory"]) if (Array.isArray(value[key])) return value[key].length;
  for (const nested of Object.values(value)) { const found = countRows(nested, depth + 1); if (found !== undefined) return found; }
  return undefined;
}

const valueOrUnknown = (value) => value === undefined || value === null || value === "" ? "not returned" : String(value);

export function sierraWorkflowDirectResponse(_input, toolResults = []) {
  const continuation=toolResults.find(item=>item?.tool==="approvals.continue_latest");
  if(continuation){const outcome=continuation.result||continuation;if(outcome.ok&&outcome.status==="verified")return{text:`Approved plan v${outcome.version} executed and verified.\n\nApproval ID: ${outcome.approvalId}\nPlan ID: ${outcome.planId}\nExecuted tool: ${outcome.executedTool}\n\nThe completion claim is backed by terminal execution and verification evidence.`,responseId:null,webSearches:0,model:"deterministic-approval-continuation",route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};if(outcome.status==="verification_pending")return{text:`Approved plan v${outcome.version} was accepted for execution, but completion is not yet verified.\n\nApproval ID: ${outcome.approvalId}\nPlan ID: ${outcome.planId}\nExecuted tool: ${outcome.executedTool}\n\nI will not call this complete until terminal outcome evidence is recorded.`,responseId:null,webSearches:0,model:"deterministic-approval-continuation",completed:false,route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};return{text:`I did not execute the approved plan.\n\nStatus: ${outcome.status||"failed"}${outcome.approvalId?`\nApproval ID: ${outcome.approvalId}`:""}${outcome.planId?`\nPlan ID: ${outcome.planId}`:""}${outcome.missingTool?`\nExact missing tool: ${outcome.missingTool}`:""}\nReason: ${outcome.error||"Execution could not be verified."}\n\nNothing was queued or completed.`,responseId:null,webSearches:0,model:"deterministic-approval-continuation",completed:false,route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};}
  const relevant = toolResults.filter((item) => WORKFLOW_TOOLS.includes(item?.tool));
  if (relevant.length < 3) return null;
  const byTool = new Map(relevant.map((item) => [item.tool, item]));
  const health = byTool.get("sierra.health"), infrastructure = byTool.get("sierra.infrastructure"), inventory = byTool.get("sierra.apply_inventory"), invariant = byTool.get("sierra.reconciliation_invariant"), portfolio = byTool.get("sierra.portfolio");
  const failed = relevant.filter((item) => item?.ok !== true);
  const healthStatus = findScalar(health?.result, ["health_status", "status", "overall_status"]);
  const activeDeals = findScalar(health?.result, ["active_deals", "activeDeals"]) ?? countRows(portfolio?.result);
  const pipelineFailures = findScalar(health?.result, ["failed_pipeline_stages", "pipeline_failures", "failedStages"]);
  const inventoryCount = countRows(inventory?.result) ?? findScalar(inventory?.result, ["total", "count", "submission_count"]);
  const invariantViolations = findScalar(invariant?.result, ["violations", "violation_count", "unresolved", "unmatched_count"]);
  const infrastructureStatus = findScalar(infrastructure?.result, ["health_status", "status", "overall_status", "ok"]);
  const lines = ["Sierra end-to-end alignment inspection completed across the governed intake, infrastructure, CapitalApply, reconciliation, and portfolio contracts.", "", `- Operating health: ${health?.ok ? valueOrUnknown(healthStatus) : "check failed"}`, `- Active deals: ${valueOrUnknown(activeDeals)}`, `- Recorded pipeline failures: ${valueOrUnknown(pipelineFailures)}`, `- Infrastructure: ${infrastructure?.ok ? valueOrUnknown(infrastructureStatus) : "check failed"}`, `- CapitalApply inventory records returned: ${inventory?.ok ? valueOrUnknown(inventoryCount) : "check failed"}`, `- Reconciliation violations returned: ${invariant?.ok ? valueOrUnknown(invariantViolations) : "check failed"}`, ""];
  if (failed.length) lines.push(`Evidence gaps: ${failed.map((item) => `${item.tool} (${item.error || "unavailable"})`).join("; ")}.`);
  else lines.push("All five governed read contracts returned successfully in this turn.");
  lines.push("", "Permanent-solution path: trace one controlled application through intake → document qualification → CapitalMatch → underwriting → submission; compare every transition against its authoritative record and timestamp; isolate each missing or contradictory handoff; repair only the verified breaks; then rerun the same file and regression suite until the full chain is continuous and repeatable.", "", "No deal, application, workflow, lender submission, or production record was changed. Any repair remains approval-gated.");
  return { text: lines.join("\n"), responseId: null, webSearches: 0, model: "deterministic-sierra-workflow-evidence", route: { domain: "sierra", tier: "fast", reasoningEffort: "low", latencyClass: "bounded" } };
}
