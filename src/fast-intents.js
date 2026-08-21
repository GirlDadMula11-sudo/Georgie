function referenceFrom(text = "") {
  const explicit = String(text).match(/\b((?:SCA[-_A-Z0-9]+|CM[-_]\d+))\b/i);
  return explicit ? explicit[1] : null;
}

const MAC_APPS = new Map([
  ["notepad", "Notes"], ["note pad", "Notes"], ["notes", "Notes"], ["note", "Notes"],
  ["safari", "Safari"], ["chrome", "Google Chrome"], ["google chrome", "Google Chrome"],
  ["mail", "Mail"], ["finder", "Finder"], ["calendar", "Calendar"], ["messages", "Messages"],
  ["preview", "Preview"], ["settings", "System Settings"], ["system settings", "System Settings"],
  ["excel", "Microsoft Excel"], ["microsoft excel", "Microsoft Excel"],
  ["word", "Microsoft Word"], ["microsoft word", "Microsoft Word"],
  ["adobe acrobat", "Adobe Acrobat Reader"], ["adobe acrobat reader", "Adobe Acrobat Reader"]
]);

function parseMacOpen(text = "") {
  const normalized = String(text).trim().toLowerCase()
    .replace(/^\s*(?:hey\s+)?georgie[,:]?\s*/, "")
    .replace(/^please\s+/, "")
    .replace(/\s+(?:on|using)\s+(?:the\s+)?mac(?:intosh)?(?:\s+(?:desktop|computer))?\s*$/, "")
    .replace(/\s+for\s+me\s*$/, "")
    .trim();
  const match = normalized.match(/^(?:open|launch|start)\s+(?:a|an|the)?\s*(.+)$/);
  if (!match) return null;
  const app = MAC_APPS.get(match[1].trim());
  return app ? app : null;
}

function parseExplicitEmailSend(text = "") {
  const raw=String(text||"").trim(); const lower=raw.toLowerCase();
  if(!/\b(send|email|e-mail|reply|forward)\b/.test(lower)) return null;
  const email=(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0];
  if(!email) return null;
  const quoted=[...raw.matchAll(/[“\"]([^”\"]+)[”\"]/g)].map(m=>m[1]).filter(Boolean);
  let body=quoted[quoted.length-1]||"";
  const saying=raw.match(/\b(?:saying|say|message|body)\s*[:,-]?\s*(.+)$/i); if(!body&&saying) body=saying[1].trim();
  if(!body) return null;
  const subjectMatch=raw.match(/\bsubject\s*[:,-]?\s*([^,.]+)(?:[,.]|$)/i);
  const subject=subjectMatch?subjectMatch[1].trim():"";
  const mailboxId=/\b(submissions|submission)\b/i.test(raw)?"submissions":"work";
  return {tool:"email.send",args:{mailboxId,to:email,subject:subject||"",text:body}};
}

export function deterministicToolPlan(input = "") {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  if (!text) return [];
  if (/\b(?:create|generate|get|give|issue|need|show)\b/.test(lower) && /\b(?:one[- ]time\s+)?enrollment code\b/.test(lower)) return [{tool:"system.create_enrollment_code",args:{}}];
  if (/\b(?:probe|test|inspect|verify|report)\b/.test(lower) && /\b(?:governed|rpc|contracts?|read access)\b/.test(lower) && /\b(?:lender[- ]activity|guarded|conflicts?|audit|infrastructure)\b/.test(lower)) return [
    {tool:"sierra.guarded_lender_conflicts",args:{reference:null,limit:50}},
    {tool:"sierra.governed_access",args:{}},
    {tool:"sierra.infrastructure",args:{}},
    {tool:"sierra.audit_events",args:{reference:null,limit:100}}
  ];
  if (/\b(?:inspect|show|identify|diagnose|explain|list)\b/.test(lower) && /\bguarded\b/.test(lower) && /\b(?:lender[- ]activity|evidence)\b/.test(lower) && /\bconflicts?\b/.test(lower)) return [{tool:"sierra.guarded_conflict_intelligence",args:{reference:referenceFrom(text),limit:50}}];
  if (/\b(?:analy[sz]e|audit|diagnose|review|inspect)\b/.test(lower) && /\b(?:georgie|repo|repository|codebase|architecture)\b/.test(lower) && /\b(?:reliability|silent|working|tool|continuity|completion|failure|weakness|crash)\b/.test(lower)) return [{tool:"developer.search",args:{repo:null,query:"completeTurnV2|respond/stream|sendTextTurn|isBusy|appendSessionTurn|executePlannedActions|verifiedDirectResponse|planActions|queueMacAndWait|recordTurnEvaluation|restoreSession|backgroundLearn"}}];
  if (/\b(?:inspect|review|check)\b/.test(lower) && /\b(?:repo|repository|codebase|working tree|git status)\b/.test(lower)) return [{tool:"developer.repo_inspect",args:{repo:null}}];
  if (/\b(?:review|inspect|check|scan|go through|look through|summarize)\b/.test(lower) && /\b(?:open\s+)?tabs?\b/.test(lower) && /\b(?:mac|safari|chrome|browser)\b/.test(lower)) return [{tool:"mac.browser_inspect",args:{includeContent:true,scope:"sierra"}}];
  if (/\b(world state|what am i working on|what are we working on|everything pending|open commitments|unfinished work)\b/.test(lower)) return [{tool:"system.world_state",args:{context:text}}];
  if (/\b(durable objectives?|unfinished engineering|blocked actions?|resume across sessions?|continuity state)\b/.test(lower)) return [{tool:"system.continuity",args:{limit:50}}];
  if (/\b(domain packs?|speciali[sz]ation packs?|installed packs?|georgie core)\b/.test(lower)) return [{tool:"system.domain_packs",args:{}}];
  const emailSend=parseExplicitEmailSend(text); if(emailSend) return [emailSend];
  const macApp=parseMacOpen(text); if(macApp) return [{tool:"mac.devices",args:{}},{tool:"mac.open_app",args:{app:macApp}}];
  const ref = referenceFrom(text);
  if (ref && /\b(?:deal intelligence|deal workspace|workspace|ready|blocked|next action)\b/.test(lower)) return [{tool:"sierra.deal_workspace",args:{reference:ref}}];
  if (/\b(?:durable|multi[- ]tool|cross[- ]system)\b/.test(lower) && /\b(?:diagnostic|investigation|inspection|plan)\b/.test(lower) && /\b(?:sierra|deal|workflow|system)\b/.test(lower)) return [{tool:"sierra.diagnostic_investigation",args:{reference:ref,scope:"sierra_end_to_end"}}];
  if (ref && /\b(?:evidence graph|complete truth|full deal truth|deal reconstruction|trace the deal|trace this deal)\b/.test(lower)) return [{tool:"sierra.evidence_graph",args:{reference:ref}}];
  const sierraWorkflowDomain = /\b(?:sierra|crm|intake|capital\s*match|capitalmatch|underwriting|submission)\b/.test(lower);
  const sierraWorkflowScope = /\b(?:entire|overall|end[- ]to[- ]end|intake|processing|capital\s*match|capitalmatch|underwriting|submission|pipeline|workflow|flow|transition|system)\b/.test(lower);
  const sierraWorkflowIntent = /\b(?:align(?:ment|ed)?|diagnos\w*|evaluate|inspect|review|audit|trace|map|disconnects?|gaps?|permanent solution|smooth transition|broken|issue|problem|what(?:'s| is) going on|help us)\b/.test(lower);
  if (sierraWorkflowDomain && sierraWorkflowScope && sierraWorkflowIntent) return [
    {tool:"sierra.health",args:{}},
    {tool:"sierra.infrastructure",args:{}},
    {tool:"sierra.apply_inventory",args:{limit:100,status:"all"}},
    {tool:"sierra.reconciliation_invariant",args:{limit:250}},
    {tool:"sierra.portfolio",args:{limit:25}}
  ];
  if (/\b(governed[- ]access|access map|rpc contracts?|rpc tools?|live read capabilities|minimum viable access)\b/.test(lower) && /\b(sierra|apply|capitalapply|rpc|capabilit(?:y|ies)|access)\b/.test(lower)) return [{tool:"sierra.governed_access",args:{}}];
  if (/\b(apply|capitalapply)\b/.test(lower) && /\b(inventory|submissions?|statuses|export|event history)\b/.test(lower)) return [{tool:"sierra.apply_inventory",args:{limit:100,status:"all"}}];
  if (/\b(audit|provenance)\b/.test(lower) && /\b(events?|history|records?|trail)\b/.test(lower)) return [{tool:"sierra.audit_events",args:{reference:ref,limit:100}}];
  if (/\b(document|storage|object storage)\b/.test(lower) && /\b(manifest|hash|permissions?|preservation|links?|locate|inventory)\b/.test(lower)) return [{tool:"sierra.document_manifest",args:{reference:ref}}];
  if (/\b(invariant|exactly one|duplicate|quarantine|reconciliation coverage)\b/.test(lower) && /\b(apply|submission|sierra|deal|record)\b/.test(lower)) return [{tool:"sierra.reconciliation_invariant",args:{limit:250}}];
  if (/\b(what|which|current|show|check|verify|do you|georgie)\b/.test(lower) && /\b(access|connections?|connected|configured|capabilit(?:y|ies)|current blockers?)\b/.test(lower)) return [{ tool: "system.status", args: {} }];
  if (/\b(show|list|what are|review|check)\b/.test(lower) && /\b(pending )?approvals?\b/.test(lower)) return [{tool:"approvals.list",args:{status:"pending",limit:25}}];
  if (/^(?:yes[,.!]?\s*)?(?:so\s+)?(?:complete|proceed|execute|apply|finish|do)\s+(?:it|that|the plan|the repair)(?:\s+now)?[,.!;:\s-]*(?:you have|with|i give|this is)\s+(?:my\s+)?approval\b/i.test(text)||/^\s*(?:approved|i approve|you have my approval)\s*(?:it|that|the plan|the repair)?[.!]?\s*$/i.test(text)) return [{tool:"approvals.continue_latest",args:{utterance:text}}];
  const approvalDecision=text.match(/^\s*(approve|reject|defer)\s+(?:approval\s+)?([0-9a-f-]{20,})(?:\s+because\s+(.+))?\s*$/i);if(approvalDecision)return[{tool:"approvals.decide",args:{approvalId:approvalDecision[2],decision:{approve:"approved",reject:"rejected",defer:"deferred"}[approvalDecision[1].toLowerCase()],note:approvalDecision[3]||""}}];
  if (/\b(neo|email|e-mail|mail)\b/.test(lower) && /\b(configured|connected|working|available|send|outbound|status|verify)\b/.test(lower)) return [{ tool: "email.accounts", args: {} }];
  const campaignStatus=lower.match(/\b(start|resume|pause|stop)\s+(?:smartlead\s+)?campaign\s+(\d+)\b/);if(campaignStatus){const status={start:"START",resume:"START",pause:"PAUSED",stop:"STOPPED"}[campaignStatus[1]];return [{tool:"campaigns.prepare_status_change",args:{campaignId:campaignStatus[2],status}}];}
  if (/\b(smartlead|campaigns?|deliverability)\b/.test(lower) && /\b(diagnos\w*|repair\w*|broken|not sending|low volume|why|problem|issue)\b/.test(lower)) return [{ tool: "campaigns.diagnose", args: {} }];
  if (/\b(smartlead|campaigns?|deliverability)\b/.test(lower) && /\b(status|health|metrics|provider|check|show|list)\b/.test(lower)) return [{ tool: "campaigns.smartlead", args: {} }];
  if (/\b(georgie|intelligence)\b/.test(lower) && /\b(score|evaluation|accuracy|latency|performance)\b/.test(lower)) return [{ tool: "system.evaluations", args: { limit: 200 } }];
  if (/\b(sierra|system|crm)\b/.test(lower) && /\b(health|healthy|status|diagnos|failure|failing|broken|stuck)\b/.test(lower)) return [{ tool: "sierra.health", args: {} }];
  if (/\b(sierra|crm|our)\b/.test(lower) && /\b(portfolio|active deals|pipeline|deals)\b/.test(lower) && !ref) return [{ tool: "sierra.portfolio", args: { limit: 25 } }];
  if (/\b(strategy|strategic|priorities|next priorities|what next|next move)\b/.test(lower) && /\b(sierra|company|business|system|technology|tech|crm|capitalmatch)\b/.test(lower)) return [{ tool: "sierra.strategy", args: {} }];
  if (/\b(network|lender network|coverage gap|product gap|lender gap)\b/.test(lower) && /\b(sierra|lender|capital|funding|network)\b/.test(lower)) return [{ tool: "sierra.network_gaps", args: {} }];
  if (ref && /\b(offer|offers|approval|approvals|terms|pricing)\b/.test(lower)) return [{ tool: "sierra.offers", args: { reference: ref } }];
  if (ref && /\b(lender|lenders|submission|response|follow up|follow-up)\b/.test(lower)) return [{ tool: "sierra.lenders", args: { reference: ref } }];
  if (ref && /\b(end.to.end|evidence chain|full evidence|reconstruct|timeline)\b/.test(lower)) return [{ tool: "sierra.evidence_chain", args: { reference: ref } }];
  if (ref && /\b(reprocess|re-read|reread|process again)\b/.test(lower) && /\b(document|application|statement)\b/.test(lower)) return [{ tool: "sierra.reprocess_documents", args: { reference: ref, reason: text.slice(0, 1000) } }];
  if (ref && /\b(reconcile|reconciliation|sync evidence)\b/.test(lower)) return [{ tool: "sierra.reconcile_deal", args: { reference: ref, reason: text.slice(0, 1000) } }];
  if (ref && /\b(verify|confirm|check)\b/.test(lower) && /\b(lender delivery|submission delivery|delivered to lender)\b/.test(lower)) return [{ tool: "sierra.verify_lender_delivery", args: { reference: ref, reason: text.slice(0, 1000) } }];
  if (ref && /\b(deal|file|status|underwriting|capitalmatch|application|evidence)\b/.test(lower)) return [{ tool: "sierra.deal", args: { reference: ref } }];
  if (ref && /\b(refresh|recompute|rerun|re-run|re-evaluate|reevaluate)\b/.test(lower)) return [{ tool: "sierra.refresh_pipeline", args: { reference: ref, reason: text.slice(0, 1000) } }];
  return [];
}
