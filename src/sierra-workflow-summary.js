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
const numberFrom=(value,keys)=>{const found=findScalar(value,keys);return typeof found==="number"?found:undefined;};
function integrityBusinessStatus(tool,result){
  if(!result?.ok)return{state:"BLOCKED",detail:result?.error||"governed check failed"};
  const data=result.result||{};
  if(tool==="sierra.reconciliation_invariant"){
    const exceptions=numberFrom(data,["exceptions","violation_count","violations","unresolved","unmatched_count"]),complete=findScalar(data,["completeness_proven"]),capitalApply=findScalar(data,["authoritative_capitalapply_pass"]),observed=findScalar(data,["sierra_observed_pass"]),legacyZero=numberFrom(data,["violation_count"])===0;
    if(exceptions===0&&((complete===true&&capitalApply===true&&observed===true)||legacyZero))return{state:"VERIFIED",detail:"all returned CapitalApply submissions are reconciled exactly once; 0 exceptions"};
    return{state:"UNKNOWN",detail:"exactly-once reconciliation was not fully proven"};
  }
  if(tool==="sierra.infrastructure"){
    const top=findScalar(data,["ok"]),status=findScalar(data,["health_status","status","overall_status"]),capitalIssues=numberFrom(data,["issue_count"]),stale=numberFrom(data,["stale_automation"]),failed=findScalar(data,["failed_pipeline_stage"]);
    if(status==="healthy"||top===true&&capitalIssues===0&&stale===0&&failed===false)return{state:"HEALTHY",detail:"core, CapitalApply, workers, and governed infrastructure checks passed"};
    return{state:"ATTENTION",detail:"one or more infrastructure acceptance conditions need review"};
  }
  return{state:"OBSERVED",detail:"current governed evidence returned"};
}

export function sierraWorkflowDirectResponse(_input, toolResults = []) {
  const revenueController=toolResults.find(item=>item?.tool==="system.revenue_controller_activate");
  if(revenueController){
    if(!revenueController.ok)return{text:`PHASE 1 ACTIVATION BLOCKED\n\n${revenueController.error||"The revenue controller could not complete its first governed cycle."}\n\nNo lender submission, external message, or consequential deal change was made.`,responseId:null,webSearches:0,model:"deterministic-revenue-controller",completed:false,terminalState:"blocked",route:{domain:"sierra",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
    const state=revenueController.result||{},coverage=state.coverage||{},controls=state.controls||{},top=(Array.isArray(state.assignments)?state.assignments:[]).slice(0,5),lines=["PHASE 1 ACTIVATED — DEAL-FLOW CONTROL",`Georgie is now assigned to ${coverage.assignedDeals??0} current Sierra deals and will refresh the portfolio every five minutes.`,"","Current operating coverage:",`- Waiting on Sierra/system work: ${coverage.waitingSystem??0}`,`- Waiting on Jason or Louri: ${coverage.waitingHuman??0}`,`- Already submitted to at least one lender: ${coverage.lenderSubmitted??0}`,`- Offers currently visible: ${coverage.offersAvailable??0}`,`- Pipeline failures: ${controls.pipelineFailures??"unknown"}`,`- Reconciliation: ${controls.reconciliationProven?`verified with ${controls.reconciliationExceptions} exceptions`:"not yet proven"}`];
    if(top.length)lines.push("","Highest-priority deal actions:",...top.map(row=>`- ${row.business} (${row.reference}): ${row.nextAction}`));
    lines.push("","Phase 2 — conversion and attribution remains locked until deal processing and source-to-funded tracking are certified.","Phase 3 — SEO, content, partner, referral, and campaign expansion remains locked until Phase 2 and capacity gates pass.","","Georgie may automatically perform only pre-certified reversible maintenance with independent verification. Lender submissions, external messages, financial actions, credentials, and consequential changes remain approval-gated.");
    return{text:lines.join("\n"),responseId:null,webSearches:0,model:"deterministic-revenue-controller",completed:true,terminalState:"verified",route:{domain:"sierra",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
  }
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
    if(outcome.status==="not_an_approval")return{text:"I did not recognize that message as approval, so I did not start anything.\n\nThere is nothing useful for you to approve until I have a real plan and approval number. I’ll show you one exact sentence to approve once both exist.",responseId:null,webSearches:0,model:"deterministic-approval-continuation",completed:false,terminalState:"approval_needed",route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
    if(outcome.status==="no_eligible_plan")return{text:"There is no valid repair plan ready for approval yet, so nothing started.\n\nNext, I need to register the complete plan and verify that it saved correctly. Once that is done, I’ll give you one exact sentence to approve it.",responseId:null,webSearches:0,model:"deterministic-approval-continuation",completed:false,terminalState:"approval_needed",route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
    const reason=outcome.error||"I could not verify that the action completed.";
    const detailLines=[outcome.missingTool?`Missing capability: ${outcome.missingTool}`:"",outcome.approvalId?`Approval: ${outcome.approvalId}`:"",outcome.planId?`Plan: ${outcome.planId}`:""].filter(Boolean);
    return{text:["I could not continue this action safely.",`What happened: ${reason}`,"What changed: nothing from this attempt.","What I’ll do next: preserve the current work and resume from the failed step once the missing requirement is available.",detailLines.length?`Details:\n${detailLines.join("\n")}`:""].filter(Boolean).join("\n\n"),responseId:null,webSearches:0,model:"deterministic-approval-continuation",completed:false,terminalState:approvalNeeded?"approval_needed":"blocked",route:{domain:"technical",tier:"fast",reasoningEffort:"low",latencyClass:"bounded"}};
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
  const maintenance=toolResults.find(item=>item?.tool==="system.maintenance_check");
  const infrastructureBusiness=integrityBusinessStatus("sierra.infrastructure",infrastructure),invariantBusiness=integrityBusinessStatus("sierra.reconciliation_invariant",invariant);
  const healthData=health?.result||{},pendingDelivery=numberFrom(healthData,["pending_lender_deliveries"]),awaitingAuthority=numberFrom(healthData,["awaiting_lender_delivery_authority_or_package"]),recoveryDue=numberFrom(healthData,["recovery_jobs_due"]),humanAttention=numberFrom(infrastructure?.result,["human_attention_pending"]);
  const verifiedDefects=(Number(pipelineFailures)||0)+Number(numberFrom(healthData,["failed_lender_deliveries"])||0)+Number(numberFrom(healthData,["failed_document_returns"])||0);
  const executiveHealth=verifiedDefects?"BLOCKED":healthStatus==="degraded"?"ATTENTION — protected work is waiting, but no system failure was returned":"HEALTHY";
  const lines = [integrityBrief?"SIERRA DEEP-SYSTEM INTEGRITY — CURRENT CONTROL BRIEF":"Sierra end-to-end alignment inspection completed across the governed intake, infrastructure, CapitalApply, reconciliation, and portfolio contracts.", "", `Overall: ${executiveHealth}`,"",`- Active deals: ${valueOrUnknown(activeDeals)}`,`- Pipeline failures: ${valueOrUnknown(pipelineFailures)}`,`- Infrastructure: ${infrastructureBusiness.state} — ${infrastructureBusiness.detail}`,`- CapitalApply: ${inventory?.ok?`${valueOrUnknown(inventoryCount)} canonical submissions observed`:"check failed"}`,`- Reconciliation: ${invariantBusiness.state} — ${invariantBusiness.detail}`];
  if(integrityBrief&&healthStatus==="degraded"&&!verifiedDefects)lines.push(`- Why attention is showing: ${awaitingAuthority??pendingDelivery??0} lender deliveries await authority or a complete package; ${recoveryDue??0} recovery jobs are due; ${humanAttention??0} items require human attention.`);
  lines.push("");
  if (failed.length) lines.push(`Evidence gaps: ${failed.map((item) => `${item.tool} (${item.error || "unavailable"})`).join("; ")}.`);
  else if(invariantBusiness.state==="UNKNOWN")lines.push("The contracts responded, but overall certification is blocked because reconciliation was not semantically proven.");
  else lines.push("Current health, infrastructure, inventory, reconciliation, and portfolio evidence returned; required machine-readable business checks passed.");
  if(integrityBrief){
    if(maintenance?.ok){
      const repairs=Array.isArray(maintenance.result?.repairs)?maintenance.result.repairs:[],latest=repairs.at(-1);
      lines.push(`Automatic maintenance: a fresh bounded observation cycle ran${latest?`; latest certified runbook ${latest.runbookId} is ${latest.result}`:"; no safe verified defect required an automatic repair"}.`);
    }else lines.push(`Maintenance-cycle evidence gap: ${maintenance?.error||"the bounded maintenance cycle did not return"}.`);
    const isolated=toolResults.filter(item=>item?.tool==="developer.search"&&item?.ok!==true);
    if(isolated.length)lines.push("A developer workspace search is incomplete, but it is an isolated engineering-evidence gap; it does not override the newer governed Sierra health results above.");
    lines.push("Fresh authoritative results from this turn outrank retained summaries and earlier timed-out jobs.");
  }
  const prepared=toolResults.find(item=>item?.tool==="approvals.prepare_plan"&&item?.ok&&item?.result?.approval?.id);
  lines.push("", "Standing operating loop: observe → diagnose → simulate → canary → automatically execute only pre-certified reversible maintenance → independently verify → rollback or close → learn. Consequential deal, lender, financial, credential, and external-message actions remain approval-gated.");
  if(prepared)lines.push("",`Bounded repair plan v${prepared.result.plan?.version||1} is saved and ready for approval.`,`Approval ID: ${prepared.result.approval.id}`,`Exact execution: ${prepared.result.plan?.execution?.tool||"not returned"}`,"Say “You are approved to fix it” to execute this exact plan and its verification reads.");
  lines.push("", verifiedDefects?"A verified defect remains; Georgie must prepare the exact reversible repair and obtain approval when the action is consequential.":"No verified system defect required a production mutation in this cycle. Protected lender actions remain gated; Georgie did not mistake waiting authorization for broken infrastructure.");
  const complete=failed.length===0&&invariantBusiness.state==="VERIFIED"&&(!integrityBrief||maintenance?.ok===true);
  return { text: lines.join("\n"), responseId: null, webSearches: 0, model: "deterministic-sierra-workflow-evidence", completed:complete, terminalState:complete?"verified":"blocked", route: { domain: "sierra", tier: "fast", reasoningEffort: "low", latencyClass: "bounded" } };
}
