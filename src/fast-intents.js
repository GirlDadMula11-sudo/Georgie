import { isExplicitConversationalApproval } from "./approval-language.js";
import { supabaseAuthHardeningPlan } from "./browser-workflow.js";

function referenceFrom(text = "") {
  const explicit = String(text).match(/\b((?:SCA[-_A-Z0-9]+|CM[-_]\d+))\b/i);
  return explicit ? explicit[1] : null;
}

function githubRepositoryScopeFrom(text="") {
  const matches=[...String(text).matchAll(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/g)].map(match=>match[1]);
  const repositories=[...new Set(matches.filter(value=>value.includes("-")||/github|sierra|georgie/i.test(value)))];
  if(repositories.length>1) throw new Error(`Conflicting GitHub repository scope: ${repositories.join(", ")}`);
  return repositories[0]||null;
}

function investigationTargetFrom(text=""){
  const reference=referenceFrom(text);if(reference)return reference;
  const quoted=String(text).match(/[“"]([^”"]{2,80})[”"]/);if(quoted)return quoted[1].trim();
  const known=String(text).match(/\b(Mr\.?\s+Muffins)\b/i);
  if(known)return known[1];
  const traced=String(text).match(/\b(?:trace|inspect|investigate|target)\s+(?:the\s+)?(.{2,80}?)\s+(?:specifically|through\s+intake|file|deal)\b/i);
  if(traced)return traced[1].replace(/^(?:deal|file)\s+/i,"").trim();
  return null;
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


function snapshotReconcileApprovalPlan(text = "") {
  const preservePaths = ["mac-agent/agent.js", "src/governed-connector.js", "src/tools.js"];
  const patterns = {
    "mac-agent/agent.js": /mac-agent\/agent\.js\s*[:=]\s*([0-9a-f]{40})/i,
    "src/governed-connector.js": /src\/governed-connector\.js\s*[:=]\s*([0-9a-f]{40})/i,
    "src/tools.js": /src\/tools\.js\s*[:=]\s*([0-9a-f]{40})/i
  };
  const expectedBlobs = Object.fromEntries(preservePaths.map(file => [file, String(text).match(patterns[file])?.[1]?.toLowerCase() || ""]));
  if (Object.values(expectedBlobs).some(hash => !/^[0-9a-f]{40}$/.test(hash))) return null;
  return {
    title: "Activate governed SEO Phase 2 Mac worker",
    summary: "Create a verified recovery snapshot, preserve only the three hash-bound bootstrap files, fast-forward /Users/mac/Georgie from origin/main, restore the preserved files, reject every unexpected dirty path or hash mismatch, restart primary-mac, and prove the governed WordPress Phase 2 batch and rollback capabilities are live.",
    steps: [
      "Verify primary-mac agent version 2.2.36 and exact working-tree scope.",
      "Reject any extra dirty, untracked, renamed, copied, or hash-different path without changing files.",
      "Create and verify a recovery snapshot and manifest.",
      "Reconcile from origin/main using fast-forward-only semantics, restore the three approved files, and restart primary-mac.",
      "Require a durable terminal receipt and semantic capability proof before any WordPress mutation."
    ],
    domain: "technical",
    risk: "high",
    reversible: true,
    verificationMethod: "Read back the verified snapshot manifest, fast-forward reconciliation result, restarted agent version, and semantic registration of browser.wordpress_phase2_batch plus browser.wordpress_phase2_rollback.",
    rollbackPlan: "Restore the verified recovery snapshot under the governed rollback path if reconciliation or capability verification fails.",
    execution: {
      tool: "developer.snapshot_reconcile_restart_from_main",
      args: {repo: "/Users/mac/Georgie", preservePaths, expectedBlobs},
      verification: []
    }
  };
}


function parseExplicitVercelMemberInvite(text = "") {
  const raw=String(text||"").trim();
  if(!/\bvercel\b/i.test(raw)||!/\b(?:invite|add)\b/i.test(raw)||!/\bdeveloper\b/i.test(raw))return null;
  const email=(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0];
  if(!email)return null;
  const explicitlyApproved=/\b(?:i approve|i authorize|you have my approval|this is my approval|approved to (?:invite|add)|treat [^.]{0,140} authorization [^.]{0,100} as approval)\b/i.test(raw);
  return{email,role:"DEVELOPER",explicitlyApproved};
}
function vercelMemberInvitePlan({email,role="DEVELOPER"}={}){
  return{title:"Invite approved Vercel developer",summary:"Invite the exact approved email to the configured Vercel team as Developer, then independently verify the provider member record and assigned role.",steps:["Invite the exact email through the governed Vercel team-member endpoint","Read the provider team-member list and verify the exact email and Developer role"],domain:"technical",risk:"high",reversible:true,verificationMethod:"Read Vercel team members from the provider and match the exact email and role.",rollbackPlan:"Do not remove the member automatically. Any later removal requires a separate explicit approval.",execution:{tool:"infrastructure_admin.vercel_team_member_invite",args:{email,role},expect:{ok:true,action:"vercel.team.member.invite"},verification:[{tool:"infrastructure_admin.vercel_team_member_verify",args:{email,role},expect:{verified:true,email,role}}]}};
}

export function deterministicToolPlan(input = "") {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  const affirmativeLower = lower.replace(/\b(?:do not|don't|never)\b[^.!?;\n]*/g,"");
  if (!text) return [];
  const exactMacJobIds=[...new Set([...text.matchAll(/\bidem-[0-9a-f]{40}\b/ig)].map(match=>match[0].toLowerCase()))];
  const exactMacJobReceipt=exactMacJobIds.length>0
    && /\b(?:receipt|result|artifact|prototype|studio|output|status|checkpoint|lease|attempt|error|log|heartbeat|agent version|online|offline|last seen)\b/i.test(text)
    && /\b(?:inspect|lookup|check|report|show|read|return|retrieve|verify|give|what|current|reconcile)\b/i.test(text)
    && !/\b(?:install|resume|build|develop|continue|update|restart|execute|repair)\b/i.test(affirmativeLower);
  if(exactMacJobReceipt){const reads=exactMacJobIds.map(jobId=>({tool:"mac.job_receipt",args:{jobId}}));if(/\b(?:heartbeat|agent version|online|offline|last seen)\b/i.test(text))reads.push({tool:"mac.devices",args:{}});return reads;}
  const investigationId=text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0];
  const approvalPlanStatus = investigationId
    && /\b(?:plan|approval|dispatch|execution|status|receipt|mac[- ]?agent|roblox[- ]?build)\b/i.test(text)
    && /\b(?:check|show|report|retrieve|read|verify|what|current|status)\b/i.test(text);
  if(approvalPlanStatus)return[{tool:"approvals.plans",args:{limit:100}},{tool:"mac.jobs",args:{limit:100}}];
  const macDeviceStatus = /\b(?:primary[- ]?mac|mac(?:intosh)?(?:\s+(?:agent|device))?)\b/i.test(text)
    && /\b(?:heartbeat|agent version|device status|online|offline|last seen)\b/i.test(text)
    && /\b(?:show|list|check|read|return|report|verify|what|exact|status)\b/i.test(text)
    && !/\b(?:prepare|create|update|restart|execute|install|repair|recover)\b/.test(affirmativeLower);
  if(macDeviceStatus)return[{tool:"mac.devices",args:{}}];
  const longRunningMacRecoveryMarker = text.match(/MAC_LONG_RUNNING_RECOVERY_JSON:\s*(\{[\s\S]*\})\s*$/i);
  if (longRunningMacRecoveryMarker) {
    let request;
    try { request = JSON.parse(longRunningMacRecoveryMarker[1]); } catch { return []; }
    const jobId = String(request?.jobId || "").toLowerCase();
    const deviceId = String(request?.deviceId || "");
    const expectedAction = String(request?.expectedAction || "");
    const requiredAgentVersion = String(request?.requiredAgentVersion || "");
    if (!/^idem-[0-9a-f]{40}$/.test(jobId)
      || deviceId !== "primary-mac"
      || expectedAction !== "roblox.install_rojo_and_build"
      || requiredAgentVersion !== "2.2.41") return [];
    return [{tool:"approvals.prepare_plan",args:{
      title:"Resume exact preserved Roblox prototype job",
      summary:`Recover ${jobId} in place on primary-mac after the deployed checkpoint transport repair. Preserve its identity and never enqueue another Roblox job.`,
      steps:["Validate the exact preserved job, action, device, and required agent version.","Requeue only the same durable job identity with its existing checkpoint receipts.","Read back the exact job receipt and primary-mac heartbeat."],
      domain:"technical",risk:"high",reversible:true,
      verificationMethod:"Require the same job ID, roblox.install_rojo_and_build action, queued or completed recovery state, agent 2.2.41 binding, and a fresh primary-mac heartbeat.",
      rollbackPlan:"Stop the preserved job without creating a replacement if its exact identity, action, checkpoint, or agent binding cannot be verified.",
      execution:{tool:"mac.long_running_job_recover",args:{jobId,deviceId,expectedAction,requiredAgentVersion},verification:[{tool:"mac.job_receipt",args:{jobId}},{tool:"mac.devices",args:{}}]}
    }}];
  }
  const robloxPlayTestMarker = text.match(/ROBLOX_PLAY_TEST_JSON:\s*(\{[\s\S]*\})\s*$/i);
  if (robloxPlayTestMarker) {
    let request;
    try { request = JSON.parse(robloxPlayTestMarker[1]); } catch { return []; }
    const projectRoot = String(request?.projectRoot || "");
    const requiredAgentVersion = String(request?.requiredAgentVersion || "");
    if (projectRoot !== "/Users/mac/Documents/Georgie Roblox Projects/makayla-horror-prototype" || requiredAgentVersion !== "2.2.41") return [];
    return [{tool:"approvals.prepare_plan",args:{
      title:"Play-test existing Makayla Roblox prototype",
      summary:"Run Roblox Studio play mode against the existing prototype, verify spawning, three relics, The Watcher chase, exit unlock, lighting, controls, and runtime startup, then stop play mode and record defects. Do not publish or create another project.",
      steps:["Verify the exact existing project and artifact path.","Run the governed Studio play test on primary-mac.","Read back every gameplay check, runtime evidence, and defect receipt."],
      domain:"technical",risk:"high",reversible:true,
      verificationMethod:"Require agent 2.2.41, all six gameplay checks true, the runtime marker observed, play mode stopped, and an empty defect list.",
      rollbackPlan:"Stop Studio play mode and preserve the existing project and Prototype.rbxlx unchanged if any check fails.",
      execution:{tool:"roblox.play_test_validate",args:{deviceId:"primary-mac",projectRoot,requiredAgentVersion},verification:[]}
    }}];
  }
  const vercelMemberInvite = parseExplicitVercelMemberInvite(text);
  if(vercelMemberInvite){
    const plan=vercelMemberInvitePlan(vercelMemberInvite);
    if(vercelMemberInvite.explicitlyApproved)return[{tool:"approvals.prepare_plan",args:plan},{tool:"approvals.continue_latest",args:{utterance:"execute the plan now, you have my approval"}}];
    return[{tool:"approvals.prepare_plan",args:plan}];
  }
  const githubReadOnlyCertification = /\b(?:read[- ]only|connector|source)\b/.test(lower) && /\bcertif(?:y|ication)\b/.test(lower) && /\bgithub\b/.test(lower);
  if (githubReadOnlyCertification) {
    const repository=githubRepositoryScopeFrom(text);
    if(!repository) throw new Error("GitHub certification requires one explicit owner/name repository scope");
    return [
      {tool:"github.repository.list",args:{repository}},
      {tool:"github.repository.get",args:{repository}},
      {tool:"github.branch.list",args:{repository}},
      {tool:"github.branch.get",args:{repository,branch:"main"}},
      {tool:"github.file.read",args:{repository,path:"package.json",ref:"main"}},
      {tool:"github.source.search",args:{repository,query:"referrals"}}
    ];
  }
  const explicitApprovalPlanLedger = /\bapprovals\.plans\b/i.test(text);
  if (explicitApprovalPlanLedger) {
    const limitMatch = text.match(/\blimit\s*[:=]?\s*(\d{1,3})\b/i);
    const limit = Math.max(1, Math.min(100, Number(limitMatch?.[1] || 25)));
    return [{tool:"approvals.plans",args:{limit}}];
  }
  const developerPatchMarker = text.match(/DEVELOPER_PATCH_JSON:\s*(\{[\s\S]*\})\s*$/i);
  if (developerPatchMarker) {
    let request;
    try { request = JSON.parse(developerPatchMarker[1]); } catch { return []; }
    const repo = String(request?.repo || "");
    const patch = String(request?.patch || "");
    if (repo !== "/Users/mac/Georgie" || !patch || patch.length > 100000) return [];
    return [{tool:"developer.prepare_patch",args:{repo,patch,title:String(request?.title||"Apply prepared Mac recovery patch").slice(0,200),summary:String(request?.summary||"Exact governed Mac recovery patch.").slice(0,2000),verificationMethod:String(request?.verificationMethod||"Run git apply --check and inspect the exact status receipt.").slice(0,2000)}}];
  }
  const developerApplyMarker = text.match(/DEVELOPER_APPLY_JSON:\s*(\{[\s\S]*\})\s*$/i);
  if (developerApplyMarker) {
    let request;
    try { request = JSON.parse(developerApplyMarker[1]); } catch { return []; }
    const approvalId = String(request?.approvalId || "");
    if (!/^[0-9a-f-]{36}$/i.test(approvalId)) return [];
    return [{tool:"approvals.prepare_plan",args:{
      title:"Apply exact approved Mac recovery patch",
      summary:"Execute only the classic developer patch approval bound to the supplied approval ID on primary-mac, then require a durable git-apply receipt.",
      steps:["Validate the classic developer patch approval and its stored SHA-256 hash.","Apply only that stored patch to /Users/mac/Georgie.","Return git diff-check and exact status evidence without committing or pushing."],
      domain:"technical",risk:"high",reversible:true,
      verificationMethod:"Require the developer.apply_approved_patch dispatch receipt, clean diff-check output, and the exact resulting worktree status.",
      rollbackPlan:"Reverse the exact stored patch if verification fails; do not commit, push, or deploy.",
      execution:{tool:"developer.apply_approved_patch",args:{approvalId,deviceId:"primary-mac"},verification:[]}
    }}];
  }
  const developerRunChecksMarker = text.match(/DEVELOPER_RUN_CHECKS_JSON:\s*(\{[\s\S]*\})\s*$/i);
  if (developerRunChecksMarker) {
    let request;
    try { request = JSON.parse(developerRunChecksMarker[1]); } catch { return []; }
    const repo = String(request?.repo || ""), script = String(request?.script || "");
    if (repo !== "/Users/mac/Georgie" || !["check","test","benchmark"].includes(script)) return [];
    return [{tool:"approvals.prepare_plan",args:{
      title:"Run exact approved Georgie check",
      summary:"Execute one allowlisted npm script on primary-mac with immutable repository and script arguments, then preserve its durable receipt.",
      steps:[`Run developer.run_checks once for npm script ${script} in /Users/mac/Georgie.`,"Return the bounded command receipt and resulting primary-mac heartbeat."],
      domain:"technical",risk:"high",reversible:true,
      verificationMethod:"Require the developer.run_checks dispatch receipt and a fresh primary-mac heartbeat.",
      rollbackPlan:"The invoked script must be self-restoring; stop without retry if its receipt is ambiguous.",
      execution:{tool:"developer.run_checks",args:{repo,script,deviceId:"primary-mac"},verification:[]}
    }}];
  }
  const governedPatchMarker = text.match(/DEVELOPER_GOVERNED_PATCH_JSON:\s*(\{[\s\S]*\})\s*$/i);
  if (governedPatchMarker) {
    let request;
    try { request = JSON.parse(governedPatchMarker[1]); } catch { return []; }
    const repo = String(request?.repo || ""), patch = String(request?.patch || ""), patchHash = String(request?.patchHash || "").toLowerCase();
    if (repo !== "/Users/mac/Georgie" || !patch || patch.length > 100000 || !/^[0-9a-f]{64}$/.test(patchHash)) return [];
    return [{tool:"approvals.prepare_plan",args:{
      title:String(request?.title||"Apply exact governed Mac patch").slice(0,200),
      summary:String(request?.summary||"Apply one patch whose full body and SHA-256 are embedded in this versioned plan.").slice(0,2000),
      steps:["Validate the embedded patch body against its SHA-256.","Apply only that exact patch to /Users/mac/Georgie on primary-mac.","Return git diff-check and exact status evidence without committing or pushing."],
      domain:"technical",risk:"high",reversible:true,
      verificationMethod:"Require the developer.apply_governed_patch dispatch receipt, clean diff-check, and exact status evidence.",
      rollbackPlan:"Reverse the exact embedded patch if verification fails; do not commit, push, or deploy.",
      execution:{tool:"developer.apply_governed_patch",args:{repo,patch,patchHash,deviceId:"primary-mac"},verification:[]}
    }}];
  }
  const explicitDeveloperFileRead = /\bdeveloper\.file_read\b/i.test(text);
  if (explicitDeveloperFileRead) {
    const repoMatch = text.match(/\brepo\s*[:=]\s*([^\s,;]+)/i);
    const pathMatch = text.match(/\bpath\s*[:=]\s*([^\s,;]+)/i);
    const repo = repoMatch?.[1] || "";
    const path = pathMatch?.[1] || "";
    if (repo === "/Users/mac/Georgie" && /^(?:mac-agent|src)\/[A-Za-z0-9._/-]+$/.test(path) && !path.split("/").includes("..")) {
      return [{tool:"developer.file_read",args:{repo,path}}];
    }
    return [];
  }
  const macUiSequencePlanRequest = /\b(?:prepare|create|register)\b/.test(lower)
    && /\b(?:immutable\s+)?(?:bounded\s+)?approval\s+plan\b/.test(lower)
    && /\bmac\.ui_sequence\b/.test(lower)
    && /\b(?:sierramarketinginc\.com|hostinger)\b/.test(lower);
  if (macUiSequencePlanRequest) {
    const marker = text.match(/UI_SEQUENCE_JSON:\s*(\[[\s\S]*\])\s*$/i);
    if (!marker) return [];
    let steps;
    try { steps = JSON.parse(marker[1]); } catch { return []; }
    const allowed = new Set(["activate_app","open_url","click","type_text","key","wait","screen_capture"]);
    if (!Array.isArray(steps) || !steps.length || steps.length > 30 || steps.some(step => !step || !allowed.has(String(step.action || "")))) return [];
    for (const step of steps) {
      if (step.action === "open_url") {
        try {
          const url = new URL(String(step.url || ""));
          const host = url.hostname.toLowerCase();
          if (url.protocol !== "https:" || !["sierramarketinginc.com","hpanel.hostinger.com"].some(domain => host === domain || host.endsWith("." + domain))) return [];
        } catch { return []; }
      }
      if (step.action === "activate_app" && String(step.app || "") !== "Google Chrome") return [];
      if (step.action === "type_text" && (!String(step.text || "") || String(step.text || "").length > 5000)) return [];
    }
    return [{
      tool:"approvals.prepare_plan",
      args:{
        title:"Run bounded Sierra sitemap browser sequence",
        summary:"Execute only the supplied, ordered Google Chrome UI actions on primary-mac within sierramarketinginc.com and Hostinger for the Rank Math sitemap repair, stopping on any unexpected state.",
        steps:steps.map((step,index)=>`${index+1}. ${step.action}`),
        domain:"technical",
        risk:"high",
        reversible:true,
        verificationMethod:"Require a durable receipt for every step and finish with a screenshot or public sitemap verification.",
        rollbackPlan:"Stop immediately on ambiguity; use Hostinger recovery or restore only the specifically changed cache artifact if a mutation must be reversed.",
        execution:{tool:"mac.ui_sequence",args:{deviceId:"primary-mac",steps},verification:[]}
      }
    }];
  }

  const wordpressBrowserInspectionPlanRequest = /\b(?:prepare|create|register)\b/.test(lower)
    && /\b(?:immutable\s+)?(?:bounded\s+)?approval\s+plan\b/.test(lower)
    && /\bmac\.(?:wordpress_hostinger_inspect|browser_inspect)\b/.test(lower)
    && /\bsierramarketinginc\.com\b/.test(lower)
    && /\bwordpress\b/.test(lower);
  if (wordpressBrowserInspectionPlanRequest) return [{
    tool:"approvals.prepare_plan",
    args:{
      title:"Verify Sierra WordPress admin session",
      summary:"Read only the approved sierramarketinginc.com browser tab on primary-mac to verify that the existing WordPress admin session is available for the bounded sitemap repair.",
      steps:[
        "Inspect only browser tabs whose domain is sierramarketinginc.com.",
        "Return the approved tab URL and title and whether WordPress admin authentication is active.",
        "Stop without interaction if login, CAPTCHA, credential entry, or another domain is encountered."
      ],
      domain:"technical",
      risk:"medium",
      reversible:true,
      verificationMethod:"The mac.wordpress_hostinger_inspect receipt must identify only approved Sierra or Hostinger Chrome tabs and explicitly report WordPress authentication state without mutation.",
      rollbackPlan:"No rollback is required because the execution is read-only; stop and preserve the receipt if any boundary is encountered.",
      execution:{
        tool:"mac.wordpress_hostinger_inspect",
        args:{siteOrigin:"https://sierramarketinginc.com",deviceId:"primary-mac",authority:"read_only",operation:"inspect_session"},
        verification:[]
      }
    }
  }];


  const georgieUpdateRestartPlanRequest = /\b(?:prepare|create|register)\b/.test(lower)
    && /\b(?:immutable\s+)?(?:bounded\s+)?(?:approval|recovery)\s+plan\b/.test(lower)
    && lower.includes("developer.update_restart_from_main")
    && text.includes("/Users/mac/Georgie");
  if (georgieUpdateRestartPlanRequest) return [{
    tool:"approvals.prepare_plan",
    args:{
      title:"Update and restart Georgie Mac agent",
      summary:"Fast-forward only the allowlisted Georgie checkout to origin/main, reconcile only remote-identical dirty paths, and restart the Mac agent so the targeted WordPress inspector becomes active.",
      steps:[
        "Fetch origin/main and inspect the exact /Users/mac/Georgie worktree.",
        "Reconcile only dirty paths that are byte-identical to origin/main; stop on any genuine local modification.",
        "Fast-forward to origin/main and restart the Mac agent.",
        "Verify the new agent heartbeat before any WordPress operation."
      ],
      domain:"technical",
      risk:"high",
      reversible:true,
      verificationMethod:"Require a completed developer.update_restart_from_main receipt followed by an online primary-mac heartbeat from the updated agent.",
      rollbackPlan:"If the fast-forward or restart fails, preserve the checkout unchanged and keep the existing Mac agent process available for recovery.",
      execution:{
        tool:"developer.update_restart_from_main",
        args:{repo:"/Users/mac/Georgie",deviceId:"primary-mac"},
        verification:[]
      }
    }
  }];

  const makaylaRobloxContinuation = /\b(?:makayla|roblox)\b/.test(lower)
    && /\b(?:prototype|game)\b/.test(lower)
    && /\b(?:update|restart|resume|build|develop|continue)\b/.test(lower);
  if (makaylaRobloxContinuation) return [{
    tool:"approvals.prepare_plan",
    args:{
      title:"Build Makayla Roblox horror prototype",
      summary:"Update Georgie's primary Mac agent, permanently install and verify Rojo when missing, resume the preserved playable horror prototype, build the Roblox place, and open it in Roblox Studio.",
      steps:["Update and restart only /Users/mac/Georgie from origin/main.","Install the pinned official Rojo release binary and verify its archive checksum, binary checksum, and exact version.","Resume the preserved original suspense-horror prototype from the retained Makayla design brief.","Build a durable Prototype.rbxlx and open it in Roblox Studio.","Return the exact artifact and receipts; never delegate Studio operation back to Jason."],
      domain:"technical",risk:"high",reversible:true,
      verificationMethod:"Require both the Mac update receipt and Roblox build receipt, plus a non-empty Prototype.rbxlx artifact path.",
      rollbackPlan:"Preserve the generated project directory; close the prototype without publishing and revert only the dedicated project files if Jason rejects the result.",
      execution:{tool:"roblox.update_agent_install_and_build",args:{deviceId:"primary-mac",projectName:"Makayla Horror Prototype",designBrief:"Original suspense-horror game inspired by the tension and atmosphere Jason and Makayla liked in House of Locust, without copying protected characters or assets. Makayla contributes design ideas and playtesting. First milestone is a polished private prototype with an explorable dark environment, collectible objectives, a pursuing creature, an escape condition, readable objective UI, and room for iterative art and story refinement.",openInStudio:true},verification:[]}
    }
  }];

  const snapshotPlanRequest = /\b(?:prepare|create|register)\b/.test(lower)
    && /\b(?:immutable\s+)?approval\s+plan\b/.test(lower)
    && /\b(?:snapshot|reconcile|primary[- ]mac|seo phase 2)\b/.test(lower)
    && lower.includes("developer.snapshot_reconcile_restart_from_main");
  if (snapshotPlanRequest) {
    const plan = snapshotReconcileApprovalPlan(text);
    return plan ? [{tool:"approvals.prepare_plan",args:plan}] : [];
  }
  if (lower.includes("developer.snapshot_reconcile_restart_from_main")) {
    const preservePaths = ["mac-agent/agent.js", "src/governed-connector.js", "src/tools.js"];
    const patterns = {
      "mac-agent/agent.js": /mac-agent\/agent\.js\s*[:=]\s*([0-9a-f]{40})/i,
      "src/governed-connector.js": /src\/governed-connector\.js\s*[:=]\s*([0-9a-f]{40})/i,
      "src/tools.js": /src\/tools\.js\s*[:=]\s*([0-9a-f]{40})/i
    };
    const expectedBlobs = Object.fromEntries(preservePaths.map(file => [file, text.match(patterns[file])?.[1]?.toLowerCase() || ""]));
    return [{tool:"developer.snapshot_reconcile_restart_from_main",args:{repo:"/Users/mac/Georgie",preservePaths,expectedBlobs}}];
  }
  if(/\b(?:create|prepare|replace)\b/.test(lower)&&/\b(?:governed\s+)?supabase plan\b/.test(lower)&&/\bleaked[- ]password protection\b/.test(lower)&&/\b(?:connection allocation|fixed 10|percentage)\b/.test(lower))return[{tool:"approvals.prepare_plan",args:supabaseAuthHardeningPlan()}];
  const phase2EngineeringInspection = /\b(?:github|vercel|render)\b/.test(lower)
    && /\b(?:repository|deployment|build|integration|monitor|handoff)\w*\b/.test(lower)
    && /\b(?:phase 2|event schema|state machine|idempoten|readiness rules?|regression tests?)\b/.test(lower);
  if (phase2EngineeringInspection) return [
    {tool:"system.github",args:{}},
    {tool:"system.vercel",args:{}},
    {tool:"system.render",args:{}},
    {tool:"developer.repo_inspect",args:{repo:null}},
    {tool:"system.phase2_foundation",args:{}}
  ];
  if (/\b(?:intelligence (?:and|&) control map|system control map|authoritative (?:system )?map)\b/.test(lower)) return [{tool:/\b(?:refresh|rebuild|update|certif(?:y|ication)|live|current)\b/.test(lower)?"system.intelligence_control_map_refresh":"system.intelligence_control_map",args:{}}];
  if (/\bapproved phase 1\b/.test(lower) || (/\b(?:activate|enable|start)\b/.test(lower) && /\bbackground (?:operating|operations|monitor|work)\b/.test(lower))) return [{tool:"system.background_operations_activate",args:{}}];
  if (/\b(?:self[- ]?(?:evol|improv|teach|learn)|continuous improvement|deep research)\w*\b/.test(lower) && /\b(?:georgie|him|yourself|capab|activate|enable|make|become|status|check)\w*\b/.test(lower)) return [{tool:"system.self_evolution_check",args:{}}];
  if(/\bactivate\b/.test(lower)&&/\bprogressive(?:ly)?\b/.test(lower))return[{tool:"system.revenue_controller_activate",args:{phase:1}}];
  if(investigationId&&/\b(?:open|show|build|generate|render|resume|continue|retrieve|read)\b/i.test(text)&&/\b(?:investigation|control brief|report|artifact)\b/i.test(text))return[{tool:"sierra.investigation_open",args:{investigationId}}];
  const integrityControlBrief = /\b(?:sierra\s+)?(?:deep[- ]system\s+)?integrity\s+program\b/.test(lower)
    || (/\bcontrol brief\b/.test(lower) && /\b(?:sierra|system|integrity|health|evidence coverage)\b/.test(lower));
  if (integrityControlBrief) return [
    {tool:"sierra.health",args:{}},
    {tool:"sierra.infrastructure",args:{}},
    {tool:"sierra.apply_inventory",args:{limit:100,status:"all"}},
    {tool:"sierra.reconciliation_invariant",args:{limit:250}},
    {tool:"sierra.portfolio",args:{limit:25}},
    {tool:"system.maintenance_check",args:{}}
  ];
  if (/\b(?:create|generate|get|give|issue|need|show)\b/.test(lower) && /\b(?:one[- ]time\s+)?enrollment code\b/.test(lower)) return [{tool:"system.create_enrollment_code",args:{}}];
  if (/\b(?:probe|test|inspect|verify|report)\b/.test(lower) && /\b(?:governed|rpc|contracts?|read access)\b/.test(lower) && /\b(?:lender[- ]activity|guarded|conflicts?|audit|infrastructure)\b/.test(lower)) return [
    {tool:"sierra.guarded_lender_conflicts",args:{reference:null,limit:50}},
    {tool:"sierra.governed_access",args:{}},
    {tool:"sierra.infrastructure",args:{}},
    {tool:"sierra.audit_events",args:{reference:null,limit:100}}
  ];
  if (/\b(?:inspect|show|identify|diagnose|explain|list)\b/.test(lower) && /\bguarded\b/.test(lower) && /\b(?:lender[- ]activity|evidence)\b/.test(lower) && /\bconflicts?\b/.test(lower)) return [{tool:"sierra.guarded_conflict_intelligence",args:{reference:referenceFrom(text),limit:50}}];
  // Operator-core upgrade: only take the deterministic developer.search shortcut when the
  // user explicitly asks to search/inspect source. Broad requests to repair, strengthen,
  // upgrade, sophisticate, or improve Georgie must reach the normal planner so it can
  // decompose the objective, select multiple tools, verify work, recover, and continue.
  const explicitDeveloperSourceSearch = /\b(?:search|grep|find|locate|inspect source|inspect code|search source|search code)\b/.test(lower)
    && /\b(?:georgie|repo|repository|codebase|architecture)\b/.test(lower)
    && /\b(?:reliability|silent|working|tool|continuity|completion|failure|weakness|crash)\b/.test(lower);
  if (explicitDeveloperSourceSearch) return [{tool:"developer.search",args:{repo:null,query:"completeTurnV2|respond/stream|sendTextTurn|isBusy|appendSessionTurn|executePlannedActions|verifiedDirectResponse|planActions|queueMacAndWait|recordTurnEvaluation|restoreSession|backgroundLearn"}}];
  const georgieRuntimeSelfInspection = /\b(?:georgie(?:'s)?|canonical runtime|runtime registry|startup authority|objective lifecycle kernel)\b/.test(lower)
    && /\b(?:self[- ]inspection|inspect|verify|certif(?:y|ication)|status|currently deployed)\b/.test(lower)
    && /\b(?:runtime|startup|component|registry|kernel|source mutation|emergency neo|durable neo|idempotent|degraded dependencies?)\b/.test(lower);
  if (georgieRuntimeSelfInspection) return [{ tool: "system.status", args: { scope: "runtime_authority" } }];
  const continuationTarget=investigationTargetFrom(text);
  if(/\b(?:continue|resume|pick up)\b/.test(lower)&&/\b(?:investigation|diagnosis|inspection|evidence)\b/.test(lower)&&continuationTarget)return [{tool:"sierra.continue_diagnostic_investigation",args:{reference:continuationTarget,scope:"deal_continuation",freshnessMs:300000}}];
  if (/\b(?:inspect|review|check)\b/.test(lower) && /\b(?:repo|repository|codebase|working tree|git status)\b/.test(lower)) return [{tool:"developer.repo_inspect",args:{repo:null}}];
  // WordPress/SEO objectives are single-domain technical work. They must bypass the
  // Sierra multi-system audit shortcut so the normal planner can select the governed
  // WordPress/Mac executor and preserve the requested scope.
  const explicitWordPressSeoObjective = /\b(?:wordpress|rank math|sitemap|seo)\b/.test(lower)
    && /\b(?:repair|regenerate|flush|verify|submit|cache|index|canonical|noindex)\b/.test(lower);
  if (explicitWordPressSeoObjective) return [];

  const multiSystemMacAudit = /\b(?:mac|desktop|browser|tabs?|safari|chrome)\b/.test(lower)
    && /\b(?:sierra|supabase|super\s*base|github|vercel|render|partner portal|capitalapply|capital apply)\b/.test(lower)
    && /\b(?:everything|all|platform|functioning|health|diagnos\w*|permanent repair|make sure)\b/.test(lower);
  if (multiSystemMacAudit) return [
    {tool:"mac.browser_inspect",args:{includeContent:true,scope:"sierra_multi_system"}},
    {tool:"system.supabase",args:{}},
    {tool:"system.github",args:{}},
    {tool:"system.vercel",args:{}},
    {tool:"system.render",args:{}},
    {tool:"sierra.health",args:{}},
    {tool:"sierra.infrastructure",args:{}},
    {tool:"sierra.apply_inventory",args:{limit:100,status:"all"}},
    {tool:"sierra.reconciliation_invariant",args:{limit:250}}
  ];
  if (/\b(?:review|inspect|check|scan|go through|look through|summarize)\b/.test(lower) && /\b(?:open\s+)?tabs?\b/.test(lower) && /\b(?:mac|safari|chrome|browser)\b/.test(lower)) return [{tool:"mac.browser_inspect",args:{includeContent:true,scope:"sierra"}}];
  const broadSierraExecution = /\b(?:sierra|capital\s*match|capitalmatch|underwriting|submission|intake|crm|our (?:entire|whole) system)\b/.test(lower)
    && /\b(?:fix|repair|complete|finish|work(?:ing)? through|attack|stabili[sz]e|prioriti[sz]e|make sure|ensure|get)\b/.test(lower)
    && /\b(?:everything|entire|whole|all|pending|priorities|functioning|operating|as designed|end[- ]to[- ]end)\b/.test(lower);
  if (broadSierraExecution) return [
    {tool:"system.reconciliation_execute_bounded",args:{scope:"broad_sierra_execution"}},
    {tool:"sierra.health",args:{}},
    {tool:"sierra.infrastructure",args:{}},
    {tool:"sierra.apply_inventory",args:{limit:100,status:"all"}},
    {tool:"sierra.reconciliation_invariant",args:{limit:250}},
    {tool:"sierra.portfolio",args:{limit:100}}
  ];
  if (/\b(world state|what am i working on|what are we working on|everything pending|open commitments|unfinished work)\b/.test(lower)) return [{tool:"system.world_state",args:{context:text}}];
  if (/\b(durable objectives?|unfinished engineering|blocked actions?|resume across sessions?|continuity state)\b/.test(lower)) return [{tool:"system.continuity",args:{limit:50}}];
  if (/\b(domain packs?|speciali[sz]ation packs?|installed packs?|georgie core)\b/.test(lower)) return [{tool:"system.domain_packs",args:{}}];
  if (/\b(?:list|show|read|return)\b/.test(lower)
    && /\b(?:recent\s+)?(?:primary[- ]mac|mac)\s+jobs?\b/.test(lower)
    && /\b(?:status|result|receipt|error|action|fields?)\b/.test(lower)) {
    const requestedLimit = Number(text.match(/\b(\d{1,3})\s+most\s+recent\b/i)?.[1] || 20);
    return [{tool:"mac.jobs",args:{limit:Math.max(1,Math.min(requestedLimit,100))}}];
  }
  const emailSend=parseExplicitEmailSend(text); if(emailSend) return [emailSend];
  const macApp=parseMacOpen(text); if(macApp) return [{tool:"mac.devices",args:{}},{tool:"mac.open_app",args:{app:macApp}}];
  const ref = referenceFrom(text);
  if (ref && /\b(?:certif(?:y|ication)|acceptance test|end[- ]to[- ]end document test|independent read[- ]back)\b/.test(lower) && /\b(?:document|application|statement|workspace|package)\b/.test(lower)) return [{tool:"sierra.document_certification",args:{reference:ref}}];
  if (ref && /\b(?:deal intelligence|deal workspace|workspace|ready|blocked|next action)\b/.test(lower)) return [{tool:"sierra.deal_workspace",args:{reference:ref}}];
  if (ref && /\b(?:document intelligence|page[- ]cited|bank statements?|application fields?|missing documents?)\b/.test(lower)) return [{tool:"sierra.document_intelligence",args:{reference:ref}}];
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
  const exactPlanApproval=text.match(/^\s*approve(?:d)?\s+plan\s+([0-9a-f-]{20,})\s+(?:under|with|using)\s+approval\s+([0-9a-f-]{20,})\s*$/i);if(exactPlanApproval)return[{tool:"approvals.approve_plan",args:{planId:exactPlanApproval[1],approvalId:exactPlanApproval[2]}}];
  if (isExplicitConversationalApproval(text)) return [{tool:"approvals.continue_latest",args:{utterance:text}}];
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

export function deterministicToolPlanWithHistory(input="",history=[]){
  const direct=deterministicToolPlan(input);if(direct.length)return direct;
  const text=String(input||"").trim();
  if(!/^(?:please\s+)?(?:continue|resume|keep going|next(?: section)?|go on)(?:\s+(?:it|the report|the investigation))?[.!]?$/i.test(text))return[];
  const turns=Array.isArray(history)?history:[];
  for(let index=turns.length-1;index>=0;index--){
    const content=String(turns[index]?.content||turns[index]?.text||"");
    if(!/\b(?:investigation|executive control brief|resumable section|persisted version)\b/i.test(content))continue;
    const investigationId=content.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0];
    if(investigationId)return[{tool:"sierra.investigation_open",args:{investigationId}}];
  }
  return[];
}

export function latestDeterministicApprovalPlan(history = []) {
  const turns = Array.isArray(history) ? history : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role !== "user" || typeof turn?.content !== "string") continue;
    const action = deterministicToolPlan(turn.content).find(item => item?.tool === "approvals.prepare_plan");
    if (action) return action;
  }
  return null;
}
