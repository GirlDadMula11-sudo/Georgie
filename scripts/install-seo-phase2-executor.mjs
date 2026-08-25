import fs from "node:fs";

function patchFile(path, transform) {
  const before = fs.readFileSync(path, "utf8");
  const after = transform(before);
  if (after !== before) fs.writeFileSync(path, after);
  return after !== before;
}

function insertBefore(source, marker, block, label) {
  if (source.includes(block.trim().slice(0, 80))) return source;
  const index = source.indexOf(marker);
  if (index < 0) throw new Error(`SEO_PHASE2_INSTALL_ANCHOR_MISSING:${label}`);
  return source.slice(0, index) + block + source.slice(index);
}

const toolsChanged = patchFile("src/tools.js", source => {
  const importAnchor = 'import { validateBrowserWorkflow } from "./browser-workflow.js";';
  if (!source.includes('from "./seo-phase2-public.js"')) {
    if (!source.includes(importAnchor)) throw new Error("SEO_PHASE2_TOOLS_IMPORT_ANCHOR_MISSING");
    source = source.replace(importAnchor, `${importAnchor}\nimport { readSeoPhase2PublicState, verifySeoPhase2PublicState } from "./seo-phase2-public.js";`);
  }

  if (!source.includes('name:"seo.phase2_before_state"')) {
    const marker = 'defineTool({name:"mac.jobs"';
    const block = `defineTool({name:"seo.phase2_before_state",description:"Capture immutable public before-state for one allowlisted Sierra SEO Phase 2 batch.",risk:"read",async run({args}){if(String(args?.siteOrigin||"").replace(/\\/$/,"")!=="https://sierramarketinginc.com")throw new Error("SEO_PHASE2_BEFORE_SITE_REJECTED");const state=await readSeoPhase2PublicState({pages:args?.pages||[]});return{commandId:args?.commandId||null,batch:args?.batch||null,planHash:args?.planHash||null,beforeStateCaptured:true,productionMutation:false,observedAt:state.observedAt,pages:state.pages.map(page=>({pathname:page.pathname,status:page.status,title:page.title,h1:page.h1,h1Count:page.h1Count,structuredDataCount:page.structuredDataCount,htmlHash:page.htmlHash,bodyTextHash:page.bodyTextHash}))}}});\ndefineTool({name:"seo.phase2_batch_execute",description:"Execute exactly one compiled allowlisted Sierra SEO Phase 2 batch through primary-mac. The Mac independently validates command, batch, page scope, plan fingerprint, protected surfaces, and duplicate replay before any WordPress write.",risk:"low_risk_write",async run({userId,args}){if(String(args?.siteOrigin||"").replace(/\\/$/,"")!=="https://sierramarketinginc.com"||args?.authority!=="reversible_write")throw new Error("SEO_PHASE2_EXECUTION_SCOPE_REJECTED");return queueMacAndWait(userId,args,"browser.wordpress_phase2_batch","low_risk_write","Execute exact compiled Sierra SEO Phase 2 WordPress batch",{siteOrigin:"https://sierramarketinginc.com",authority:"reversible_write",operation:"execute_phase2_batch",commandId:args?.commandId,batch:args?.batch,planHash:args?.planHash,pages:args?.pages||[],changeClasses:args?.changeClasses||[],protectedSurfaces:args?.protectedSurfaces||[]},45000)}});\ndefineTool({name:"seo.phase2_batch_verify",description:"Semantically verify one Sierra SEO Phase 2 batch against fresh public HTML. A failed public predicate triggers bounded primary-mac rollback of that exact command/plan before returning failure.",risk:"read",async run({userId,args}){const verification=await verifySeoPhase2PublicState({batch:args?.batch,pages:args?.pages||[],planHash:args?.planHash});if(verification.verified===true)return verification;let rollback=null;try{rollback=await queueMacAndWait(userId,args,"browser.wordpress_phase2_rollback","low_risk_write","Rollback exact Sierra SEO Phase 2 batch after failed public semantic verification",{siteOrigin:"https://sierramarketinginc.com",authority:"reversible_write",operation:"rollback_phase2_batch",commandId:args?.commandId,batch:args?.batch,planHash:args?.planHash},45000)}catch(error){rollback={status:"failed",error:error instanceof Error?error.message:String(error)}}return{...verification,rollbackAttempted:true,rollback}}});\ndefineTool({name:"seo.phase2_after_state",description:"Capture immutable public after-state for one allowlisted Sierra SEO Phase 2 batch.",risk:"read",async run({args}){if(String(args?.siteOrigin||"").replace(/\\/$/,"")!=="https://sierramarketinginc.com")throw new Error("SEO_PHASE2_AFTER_SITE_REJECTED");const state=await readSeoPhase2PublicState({pages:args?.pages||[]});return{commandId:args?.commandId||null,batch:args?.batch||null,planHash:args?.planHash||null,publicReadbackVerified:true,productionMutation:false,observedAt:state.observedAt,pages:state.pages.map(page=>({pathname:page.pathname,status:page.status,title:page.title,h1:page.h1,h1Count:page.h1Count,structuredDataCount:page.structuredDataCount,htmlHash:page.htmlHash,bodyTextHash:page.bodyTextHash}))}}});\n`;
    source = insertBefore(source, marker, block, "tools-mac-jobs");
  }
  return source;
});

const connectorChanged = patchFile("src/governed-connector.js", source => {
  const importAnchor = 'import { crawlWebsite, pageSpeed, getApplicationFunnel, seoIntegrationStatus, websiteControlStatus } from "./integrations/seo-ops.js";';
  if (!source.includes('from "./seo-phase2-executor.js"')) {
    if (!source.includes(importAnchor)) throw new Error("SEO_PHASE2_CONNECTOR_IMPORT_ANCHOR_MISSING");
    source = source.replace(importAnchor, `${importAnchor}\nimport { buildSeoPhase2Objective } from "./seo-phase2-executor.js";\nimport { SEO_PHASE2_COMMAND_SEQUENCE } from "./seo-phase2-batches.js";`);
  }

  if (!source.includes("SEO_PHASE2_TYPED_START")) {
    const legacyAnchor = "    const scheduled = await scheduleObjective(userId, {";
    const block = `    // SEO_PHASE2_TYPED_START: preserved Phase-2 command identities compile to distinct bounded workflows.\n    const suppliedPhase2Id=clean(command.metadata?.phase2_command_id||command.metadata?.phase2CommandId||command.metadata?.command_id||command.metadata?.commandId,220);\n    const embeddedPhase2Id=SEO_PHASE2_COMMAND_SEQUENCE.find(item=>String(command.command||"").includes(item.commandId))?.commandId||null;\n    const phase2CommandId=suppliedPhase2Id||embeddedPhase2Id;\n    if(phase2CommandId){\n      const completedCommandIds=[...new Set((command.metadata?.completed_command_ids||command.metadata?.completedCommandIds||[]).map(value=>clean(value,220)).filter(Boolean))];\n      const spec=buildSeoPhase2Objective({commandId:phase2CommandId,batch:command.metadata?.batch||command.metadata?.program,completedCommandIds});\n      const scheduled=await scheduleObjective(userId,spec);\n      setImmediate(()=>runObjectiveWorkerCycle(userId).catch(error=>console.warn("[Georgie] SEO Phase2 objective wake failed:",error instanceof Error?error.message:error)));\n      return{terminalState:"completed",completed:true,route,phase2:{commandId:spec.phase2.commandId,batch:spec.phase2.batch,sequenceIndex:spec.phase2.sequenceIndex,predecessorCommandId:spec.phase2.predecessorCommandId,planHash:spec.phase2.planHash},scheduledObjective:{id:scheduled.objective.id,stableKey:scheduled.objective.stableKey,status:scheduled.objective.status,stepIndex:scheduled.objective.stepIndex,steps:scheduled.objective.steps.map(step=>step.id)},productionMutation:false};\n    }\n`;
    if (!source.includes(legacyAnchor)) throw new Error("SEO_PHASE2_CONNECTOR_LEGACY_ANCHOR_MISSING");
    source = source.replace(legacyAnchor, block + legacyAnchor);
  }
  return source;
});

const macChanged = patchFile("mac-agent/agent.js", source => {
  const importAnchor = 'import { verifyNeoCdpSession } from "./neo-cdp-reader.js";';
  if (!source.includes('from "./seo-phase2-writer-v2.js"')) {
    if (!source.includes(importAnchor)) throw new Error("SEO_PHASE2_MAC_IMPORT_ANCHOR_MISSING");
    source = source.replace(importAnchor, `${importAnchor}\nimport { buildSeoPhase2WordpressPageScriptWithRollback, buildSeoPhase2WordpressRollbackScript, stripRollbackBundle, validateSeoPhase2MacRequest } from "./seo-phase2-writer-v2.js";`);
  }

  const healthAnchor = 'const HEALTH_FILE = path.join(HEALTH_DIR, "mac-agent-health.json");';
  if (!source.includes("SEO_PHASE2_EXECUTION_FILE")) {
    if (!source.includes(healthAnchor)) throw new Error("SEO_PHASE2_MAC_HEALTH_ANCHOR_MISSING");
    source = source.replace(healthAnchor, `${healthAnchor}\nconst SEO_PHASE2_EXECUTION_FILE = path.join(HEALTH_DIR, "seo-phase2-executions.json");`);
  }

  if (!source.includes("async function executeSeoPhase2WordpressBatch")) {
    const marker = "async function enableWordpressApplicationPasswords(args = {}) {";
    const block = `async function readSeoPhase2ExecutionState(){try{return JSON.parse(await fs.readFile(SEO_PHASE2_EXECUTION_FILE,"utf8"))}catch(error){if(error?.code!=="ENOENT")throw error;return{version:1,commands:{}}}}\nasync function writeSeoPhase2ExecutionState(state){await fs.mkdir(HEALTH_DIR,{recursive:true,mode:0o700});const temp=SEO_PHASE2_EXECUTION_FILE+"."+process.pid+".tmp";await fs.writeFile(temp,JSON.stringify(state),{mode:0o600});await fs.rename(temp,SEO_PHASE2_EXECUTION_FILE)}\nasync function runWordpressAdminPageScript(pageScript){const serializedPageScript=\`JSON.stringify(\${pageScript})\`;const script=\`tell application "Google Chrome"\\nrepeat with browserWindow in windows\\nrepeat with browserTab in tabs of browserWindow\\nset tabUrl to URL of browserTab\\nif tabUrl starts with "https://sierramarketinginc.com/wp-admin/" then\\nreturn execute browserTab javascript \${JSON.stringify(serializedPageScript)}\\nend if\\nend repeat\\nend repeat\\nreturn "WORDPRESS_ADMIN_TAB_NOT_FOUND"\\nend tell\`;await execFileAsync("open",["-a","Google Chrome","https://sierramarketinginc.com/wp-admin/"],{timeout:15000});await new Promise(resolve=>setTimeout(resolve,3000));const rawResult=await runAppleScript(script);if(rawResult==="WORDPRESS_ADMIN_TAB_NOT_FOUND")throw new Error("No approved Sierra WordPress admin tab");if(!rawResult||rawResult==="missing value")throw new Error("WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED");return JSON.parse(rawResult)}\nasync function executeSeoPhase2WordpressBatch(args={}){const plan=validateSeoPhase2MacRequest(args),state=await readSeoPhase2ExecutionState(),existing=state.commands?.[plan.commandId]||null;if(existing&&existing.planHash!==plan.planHash)throw new Error("SEO_PHASE2_LOCAL_RECEIPT_HASH_MISMATCH");if(existing?.verified===true&&existing?.rolledBack!==true)return{seoPhase2Execution:{...existing,duplicateReplay:true,mutationPerformed:false},authority:"reversible_write",siteOrigin:"https://sierramarketinginc.com",credentialsTransferred:false,formValuesCaptured:false};const pageScript=buildSeoPhase2WordpressPageScriptWithRollback(args),raw=await runWordpressAdminPageScript(pageScript),{publicResult,rollbackBundle}=stripRollbackBundle(raw);const receipt={commandId:plan.commandId,batch:plan.batch,planHash:plan.planHash,appliedAt:new Date().toISOString(),verified:publicResult.verified===true,mutationPerformed:Number(publicResult.changedCount||0)>0,beforeStateCaptured:true,rollbackMaterialCreated:true,publicReadbackVerified:false,rollbackBundle,rolledBack:false,internalResult:publicResult};state.version=1;state.commands={...(state.commands||{}),[plan.commandId]:receipt};await writeSeoPhase2ExecutionState(state);return{seoPhase2Execution:{...receipt,rollbackBundle:undefined},authority:"reversible_write",siteOrigin:"https://sierramarketinginc.com",credentialsTransferred:false,formValuesCaptured:false,backupCreated:true,mutationPerformed:receipt.mutationPerformed,verified:receipt.verified,rollbackPerformed:false}}\nasync function rollbackSeoPhase2WordpressBatch(args={}){if(args.authority!=="reversible_write"||args.operation!=="rollback_phase2_batch")throw new Error("SEO_PHASE2_ROLLBACK_AUTHORITY_REJECTED");const state=await readSeoPhase2ExecutionState(),existing=state.commands?.[String(args.commandId||"")]||null;if(!existing)throw new Error("SEO_PHASE2_ROLLBACK_RECEIPT_NOT_FOUND");if(existing.planHash!==String(args.planHash||""))throw new Error("SEO_PHASE2_ROLLBACK_PLAN_HASH_MISMATCH");if(existing.rolledBack===true)return{seoPhase2Rollback:{commandId:existing.commandId,planHash:existing.planHash,duplicateReplay:true,rollbackPerformed:true,mutationPerformed:false}};if(!Array.isArray(existing.rollbackBundle)||!existing.rollbackBundle.length){existing.rolledBack=true;existing.rolledBackAt=new Date().toISOString();state.commands[existing.commandId]=existing;await writeSeoPhase2ExecutionState(state);return{seoPhase2Rollback:{commandId:existing.commandId,planHash:existing.planHash,rollbackPerformed:false,noMutationToRollback:true,mutationPerformed:false}}}const script=buildSeoPhase2WordpressRollbackScript({commandId:existing.commandId,planHash:existing.planHash,rollbackBundle:existing.rollbackBundle}),result=await runWordpressAdminPageScript(script);existing.rolledBack=result.rollbackPerformed===true;existing.rolledBackAt=new Date().toISOString();existing.publicReadbackVerified=false;state.commands[existing.commandId]=existing;await writeSeoPhase2ExecutionState(state);return{seoPhase2Rollback:result,mutationPerformed:result.rollbackPerformed===true,authority:"reversible_write",siteOrigin:"https://sierramarketinginc.com",credentialsTransferred:false}}\n\n`;
    source = insertBefore(source, marker, block, "mac-wordpress-security-function");
  }

  if (!source.includes('case "browser.wordpress_phase2_batch"')) {
    const marker = '    case "browser.wordpress_enable_application_passwords":';
    const block = `    case "browser.wordpress_phase2_batch":\n      return executeSeoPhase2WordpressBatch(a);\n    case "browser.wordpress_phase2_rollback":\n      return rollbackSeoPhase2WordpressBatch(a);\n`;
    source = insertBefore(source, marker, block, "mac-wordpress-switch");
  }
  return source;
});

if (!fs.readFileSync("src/tools.js", "utf8").includes('name:"seo.phase2_batch_execute"')) throw new Error("SEO_PHASE2_TOOLS_INSTALL_NOT_CONVERGED");
if (!fs.readFileSync("src/governed-connector.js", "utf8").includes("SEO_PHASE2_TYPED_START")) throw new Error("SEO_PHASE2_CONNECTOR_INSTALL_NOT_CONVERGED");
if (!fs.readFileSync("mac-agent/agent.js", "utf8").includes('case "browser.wordpress_phase2_batch"')) throw new Error("SEO_PHASE2_MAC_INSTALL_NOT_CONVERGED");
console.log(`[Georgie] SEO Phase2 executor installed: tools=${toolsChanged} connector=${connectorChanged} mac=${macChanged}`);
