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
const semanticLine=item=>`- ${item.tool}: ${item.state||"UNKNOWN"} — ${item.reason||item.error||"No semantic result returned."}`;

export function sierraWorkflowDirectResponse(_input, toolResults = []) {
  const continuation=toolResults.find(item=>item?.tool==="approvals.continue_latest");
  if(continuation){
    const outcome=continuation.result||continuation;
    const execution=outcome.result||{};
    const lanes=Array.isArray(execution.lanes)?execution.lanes:[];
    const checked=[outcome.executedTool,...(outcome.verification||[]).map(item=>item.tool)].filter(Boolean);
    const queued=lanes.filter(item=>item.status==="queued");
    const failed=lanes.filter(item=>item.status==="failed");
    const observed=lanes.filter(item=>item.status==="observed_only");
    const verifiedReads=(outcome.verification||[]).filter(item=>item.ok&&item.accepted);
    const semanticChecks=[outcome.executionVerification?{tool:outcome.executedTool,...outcome.executionVerification}:null,...(outcome.verification||[])].filter(Boolean);
    const sections=[
      `What I checked: ${checked.length?checked.join(", "):"the approved bounded plan"}.`,
      `What I found: ${lanes.length?`${lanes.length} reconciliation lanes — ${queued.length} queued, ${observed.length} observed, ${failed.length} failed`:"the execution returned no lane-level result"}.`,
      `What changed: ${queued.length?`${queued.length} bounded downstream action${queued.length===1?" was":"s were"} queued; no resulting record change is claimed yet`:"no unverified production change is claimed"}.`,
      `What I verified: ${verifiedReads.length}/${(outcome.verification||[]).length} required read-backs passed their business acceptance criteria.`,
      "Business outcome checks:\n"+semanticChecks.map(semanticLine).join("\n"),
      `What remains: ${queued.length?`${queued.length} queued action${queued.length===1?" needs":"s need"} terminal execution and read-back evidence`:failed.length?`${failed.length} failed lane${failed.length===1?" requires":"s require"} recovery`:semanticChecks.some(item=>item.accepted!==true)?"one or more business outcomes are failed or unknown; completion is blocked":"nothing within this bounded plan"}.`
    ];
    const ids=`Approval ID: ${outcome.approvalId||"not returned"}\nPlan ID: ${outcome.planId||"not returned"}`;
    if(outcome.ok&&outcome.status==="verified")return{text:[`TASK COMPLETED — Approved plan v${outcome.version}.`,...sections,ids].join("\n\n"),responseId:null,webSearches:0,model:"deterministic-approval-continuation",terminalState:"completed",route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
    if(outcome.status==="verification_pending")return{text:[`IN PROGRESS — Approved plan v${outcome.version} started, but its business outcome is not terminal.`,...sections,ids,"I will not call this completed until terminal outcome evidence is recorded."].join("\n\n"),responseId:null,webSearches:0,model:"deterministic-approval-continuation",completed:false,terminalState:"in_progress",route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
    if(outcome.status==="blocked_incomplete_evidence")return{text:[`NEEDS ATTENTION — The approved action ran, but the repair is not proven.`,...sections,ids,"Georgie stopped here because observation or incomplete evidence cannot prove that Sierra was repaired. No additional production action will run from this plan."].join("\n\n"),responseId:null,webSearches:0,model:"deterministic-approval-continuation",completed:false,terminalState:"blocked",route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
    const approvalNeeded=outcome.status==="no_eligible_plan"||outcome.status==="not_an_approval";
    return{text:[approvalNeeded?"APPROVAL NEEDED":"BLOCKED",`Status: ${outcome.status||"failed"}`,outcome.missingTool?`Exact missing tool: ${outcome.missingTool}`:"",`Reason: ${outcome.error||"Execution could not be verified."}`,ids,"Nothing was falsely marked complete."].filter(Boolean).join("\n\n"),responseId:null,webSearches:0,model:"deterministic-approval-continuation",completed:false,terminalState:approvalNeeded?"approval_needed":"blocked",route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
  }
  const continued=toolResults.find(item=>item?.tool==="sierra.continue_diagnostic_investigation");
  if(continued){
    if(!continued.ok)return{text:`BLOCKED\n\nWhat I checked: continuation routing and durable investigation access.\n\nWhat I found: the continued investigation could not run.\n\nWhat changed: nothing.\n\nWhat I verified: no terminal deal-level result.\n\nWhat remains: ${continued.error||"the continuation contract failed without a usable result"}.\n\nNo repair plan was created.`,responseId:null,webSearches:0,model:"deterministic-sierra-continuation",completed:false,terminalState:"blocked",route:{domain:"sierra",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
    const plan=continued.result||{},steps=Array.isArray(plan.steps)?plan.steps:[],synthesis=plan.synthesis||{},unresolved=Array.isArray(synthesis.unresolved)?synthesis.unresolved:[],businessGaps=Array.isArray(synthesis.businessGaps)?synthesis.businessGaps:[],completed=steps.filter(step=>step.status==="completed"),failed=steps.filter(step=>step.status==="failed"),verifiedBreaks=Array.isArray(synthesis.verifiedBreaks)?synthesis.verifiedBreaks:[];
    const status=unresolved.length||failed.length?"blocked":"completed";
    const checked=completed.map(step=>step.tool).join(", ")||"no required contract completed";
    const findings=businessGaps.length?businessGaps.map((gap,index)=>`${index+1}. Missing: ${gap.missing}\nWhy it matters: ${gap.why}\nAuthoritative source: ${gap.source}\nExact next action: ${gap.nextAction}`).join("\n\n"):`${completed.length}/${steps.length} required deal-level contracts returned without unresolved intake-to-submission evidence`;
    const remaining=businessGaps.length?businessGaps.map(item=>item.missing).join(", "):"no unresolved required intake-to-submission evidence";
    const repair=plan.repairPlan?`BOUNDED REPAIR PLAN — APPROVAL NEEDED\nExecution: ${plan.repairPlan.execution.tool}\nScope: ${plan.repairPlan.scope.join("; ")}\nExcluded: ${plan.repairPlan.excluded.join("; ")}\nVerification: ${plan.repairPlan.verification.map(item=>item.tool).join(", ")}\nThe deal remains blocked until both read-backs succeed.`:verifiedBreaks.length?`Verified extraction or record defects: ${verifiedBreaks.map(item=>item.missing).join("; ")}. No production action was executed.`:"No repair plan was created because the evidence indicates missing source material or no verified system defect.";
    return{text:[status==="completed"?"TASK COMPLETED":"BLOCKED — INCOMPLETE EVIDENCE",`Investigation: ${plan.requestId||"not returned"}`,`Target: ${plan.target||plan.reference||"not returned"}${plan.reference&&plan.target&&plan.reference!==plan.target?` → ${plan.reference}`:""}`,`Reference resolution: ${plan.resolution||"not returned"}`,`Continued from: ${plan.continuationOf||"no prior durable deal investigation was available"}`,`What I checked: ${checked}.`,`What I found: ${findings}.`,"What changed: no Sierra record, document, workflow, lender submission, or external communication was changed.",`What I verified: ${completed.length}/${steps.length} required contracts; fresh evidence reused for ${plan.skippedFreshTools?.length||0} contract(s).`,`What remains: ${remaining}.`,repair].join("\n\n"),responseId:null,webSearches:0,model:"deterministic-sierra-continuation",completed:status==="completed",terminalState:status,route:{domain:"sierra",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
  }
  const investigation=toolResults.find(item=>item?.tool==="sierra.diagnostic_investigation");
  if(investigation){if(!investigation.ok)return{text:`The durable Sierra investigation could not start: ${investigation.error||"diagnostic storage or execution was unavailable"}. No records were changed.`,responseId:null,webSearches:0,model:"deterministic-sierra-evidence",route:{domain:"sierra",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};const plan=investigation.result||{},summary=plan.synthesis||{},coverage=plan.artifact?.evidenceCoverage,verified=coverage?.readBackPassed===true;return{text:[`Durable Sierra investigation ${plan.requestId} ${verified?plan.status:"blocked_incomplete_evidence"}.`,`Scope: ${plan.scope||"sierra_end_to_end"}${plan.reference?` · Deal: ${plan.reference}`:""}`,`Evidence persisted and read back: ${coverage?.verified??0}/${coverage?.total??summary.total??0} independent contract payloads.`,`Report state: ${plan.artifact?.status||"artifact_not_verified"}; next undelivered section: ${plan.artifact?.nextUndeliveredSection||"not returned"}.`,`Contradictions preserved: ${summary.contradictions?.length??0}.`,`Evidence gaps: ${summary.evidenceGaps?.length?summary.evidenceGaps.map(item=>`${item.tool}: ${item.error}`).join("; "):verified?"none returned":"artifact read-back was not verified"}.`,"No deal, submission, communication, or production record was changed."].join("\n"),responseId:null,webSearches:0,model:"deterministic-sierra-evidence",completed:verified&&plan.status==="completed",terminalState:verified&&plan.status==="completed"?"completed":"blocked",investigationArtifact:{id:plan.requestId,sections:["executive-verdict","contract-evidence","gaps-and-contradictions","next-action"],status:plan.artifact?.status||"artifact_not_verified"},route:{domain:"sierra",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};}
  const graphResult=toolResults.find(item=>item?.tool==="sierra.evidence_graph"||item?.tool==="sierra.evidence_chain");
  if(graphResult?.ok){const graph=graphResult.result||{};return{text:[`Deal evidence graph reconstructed for ${graph.reference||"the requested deal"}.`,`Coverage: ${graph.coverage?.evidencedStages??0}/${graph.coverage?.totalStages??10} stages evidenced.`,`Contradictions preserved: ${graph.contradictions?.length??0}.`,`Explicit unknown fields: ${graph.unknowns?.length??0}.`,`Sources: ${(graph.sourceContracts||[]).join(", ")||"not returned"}.`,"No source record was overwritten and no production write was performed."].join("\n"),responseId:null,webSearches:0,model:"deterministic-sierra-evidence",route:{domain:"sierra",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};}
  const conflictResult=toolResults.find(item=>item?.tool==="sierra.guarded_conflict_intelligence");
  if(conflictResult?.ok){const result=conflictResult.result||{};return{text:[`Guarded-conflict inspection returned ${result.count??0} record-level conflict${result.count===1?"":"s"}.`,`Unresolved: ${result.unresolved??"unknown"}.`,`Contract: ${result.contract||"not returned"}.`,`Unknown fields remain explicit; conflicting source evidence was preserved rather than overwritten.`,`No conflict was reconciled and no production record was changed.`].join("\n"),responseId:null,webSearches:0,model:"deterministic-sierra-evidence",route:{domain:"sierra",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};}
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
  const integrityBrief=/\b(?:deep[- ]system\s+integrity|integrity\s+program|control brief)\b/i.test(String(_input||""));
  const maintenance=toolResults.find(item=>item?.tool==="system.maintenance");
  const lines = [integrityBrief?"SIERRA DEEP-SYSTEM INTEGRITY — CURRENT CONTROL BRIEF":"Sierra end-to-end alignment inspection completed across the governed intake, infrastructure, CapitalApply, reconciliation, and portfolio contracts.", "", `- Operating health: ${health?.ok ? valueOrUnknown(healthStatus) : "check failed"}`, `- Active deals: ${valueOrUnknown(activeDeals)}`, `- Recorded pipeline failures: ${valueOrUnknown(pipelineFailures)}`, `- Infrastructure: ${infrastructure?.ok ? valueOrUnknown(infrastructureStatus) : "check failed"}`, `- CapitalApply inventory records returned: ${inventory?.ok ? valueOrUnknown(inventoryCount) : "check failed"}`, `- Reconciliation violations returned: ${invariant?.ok ? valueOrUnknown(invariantViolations) : "check failed"}`, ""];
  if (failed.length) lines.push(`Evidence gaps: ${failed.map((item) => `${item.tool} (${item.error || "unavailable"})`).join("; ")}.`);
  else lines.push("All five governed read contracts returned successfully in this turn.");
  if(integrityBrief){
    if(maintenance?.ok)lines.push("The durable maintenance state was also read successfully in this turn.");
    else lines.push(`Maintenance-state evidence gap: ${maintenance?.error||"the durable maintenance contract did not return"}.`);
    const isolated=toolResults.filter(item=>item?.tool==="developer.search"&&item?.ok!==true);
    if(isolated.length)lines.push("A developer workspace search is incomplete, but it is an isolated engineering-evidence gap; it does not override the newer governed Sierra health results above.");
    lines.push("Fresh authoritative results from this turn outrank retained summaries and earlier timed-out jobs.");
  }
  const prepared=toolResults.find(item=>item?.tool==="approvals.prepare_plan"&&item?.ok&&item?.result?.approval?.id);
  lines.push("", "Permanent-solution path: trace one controlled application through intake → document qualification → CapitalMatch → underwriting → submission; compare every transition against its authoritative record and timestamp; isolate each missing or contradictory handoff; repair only the verified breaks; then rerun the same file and regression suite until the full chain is continuous and repeatable.");
  if(prepared)lines.push("",`Bounded repair plan v${prepared.result.plan?.version||1} is saved and ready for approval.`,`Approval ID: ${prepared.result.approval.id}`,`Exact execution: ${prepared.result.plan?.execution?.tool||"not returned"}`,"Say “You are approved to fix it” to execute this exact plan and its verification reads.");
  lines.push("", "No deal, application, workflow, lender submission, or production record was changed. Any repair remains approval-gated.");
  return { text: lines.join("\n"), responseId: null, webSearches: 0, model: "deterministic-sierra-workflow-evidence", completed:failed.length===0&&(!integrityBrief||maintenance?.ok===true), terminalState:failed.length||integrityBrief&&maintenance?.ok!==true?"blocked":"verified", route: { domain: "sierra", tier: "fast", reasoningEffort: "low", latencyClass: "bounded" } };
}
