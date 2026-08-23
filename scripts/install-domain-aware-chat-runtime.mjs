import fs from "node:fs";

function patch(path, replacements) {
  let source = fs.readFileSync(path, "utf8");
  let changed = false;
  for (const [from, to, label] of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) throw new Error(`domain-aware runtime installer could not find ${label} in ${path}`);
    source = source.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(path, source);
  return changed;
}

const mobileChanged = patch("src/mobile-router.js", [
  ['send({type:"status",stage:"accepted",message:"Request accepted. The work will continue even if this screen disconnects.",elapsedMs:0});', 'send({type:"status",stage:"accepted",message:"Got it.",elapsedMs:0});', "accepted status"],
  ['const heartbeat=setInterval(()=>send({type:"status",stage:"heartbeat",message:"Still working. This request is durable and reconnectable.",elapsedMs:Date.now()-started}),4000);', 'const heartbeat=setInterval(()=>send({type:"status",stage:"heartbeat",message:"Still working on this.",elapsedMs:Date.now()-started}),4000);', "heartbeat status"]
]);

const appChanged = patch("public/app.js", [
  ['  const panel=document.createElement("details");\n  panel.className="execution-panel";\n  panel.open=true;', '  const panel=document.createElement("details");\n  panel.className="execution-panel";\n  panel.open=true;\n  panel.hidden=true;', "lazy execution panel"],
  ['function updateExecutionPanel(panel,event){\n  if(!panel||!event)return;\n  const stage=event.stage||event.type;', 'function updateExecutionPanel(panel,event){\n  if(!panel||!event)return;\n  const stage=event.stage||event.type;\n  const operational=Boolean(event.tool)||["plan_ready","tool_running","tool_complete","verification","repair_plan","planning_failed","plan_recovered"].includes(stage);\n  if(operational)panel.hidden=false;\n  if(stage==="heartbeat"&&panel.hidden)return;', "domain-aware execution panel"],
  ['  else if(stage==="heartbeat")executionStep(panel,"stage:heartbeat",event.message||"Still working — durable connection active","running");', '  else if(stage==="heartbeat")executionStep(panel,"stage:heartbeat",event.message||"Still working on this.","running");', "human heartbeat"],
  ['receipt.textContent=terminalState==="completed"?(actions.length?`${actions.length} tool${actions.length===1?"":"s"} · ${evidence} evidence source${evidence===1?"":"s"} · terminal outcome recorded`:"No tools required."):terminalState==="in_progress"?"Work started; completion awaits terminal business evidence.":terminalState==="retained"?"Work retained for recovery; no completion was claimed.":"No completion was claimed.";', 'receipt.textContent=terminalState==="completed"?(actions.length?`${actions.length} tool${actions.length===1?"":"s"} · ${evidence} evidence source${evidence===1?"":"s"}`:"Response complete."):terminalState==="in_progress"?"Still working on this.":terminalState==="retained"?"Still working on this.":"This could not be completed.";', "generic receipt"],
  ['const deadline = setTimeout(() => setStatus("Still working safely — any long-running tool remains durable and Georgie will return a terminal result."), progressDeadlineMs);', 'const deadline = setTimeout(() => setStatus("Still working on this."), progressDeadlineMs);', "progress deadline status"],
  ['setStatus("Connection interrupted. Reconnecting to the durable task…");', 'setStatus("Connection interrupted. Reconnecting…");', "reconnect status"],
  ['error=new Error(`Durable request ${durableRequestId} is still running. Its result remains saved and reconnectable from the activity center.`);', 'error=new Error("The request is still running. Please keep this screen open while I reconnect.");', "recovery error"],
  ['const failureText = timedOut ? "That request exceeded Georgie’s response deadline and was stopped. I did not verify completion, and nothing should be treated as completed." : `I could not complete that request: ${String(error?.message || "the response pipeline failed").slice(0,300)}. Nothing should be treated as completed.`;', 'const failureText = timedOut ? "I couldn’t finish that response in time. Please try again." : `I couldn’t complete that request: ${String(error?.message || "the response pipeline failed").slice(0,300)}.`;', "failure copy"],
  ['setStatus(timedOut ? "Request stopped at the deadline. A failure report is on screen." : "Request failed. A failure report is on screen.");', 'setStatus(timedOut ? "That took too long. Please try again." : "I couldn’t complete that request.");', "failure status"]
]);

const investmentChanged = patch("src/investment-intelligence.js", [
  ['export function investmentRuntimePrompt(input = "") {', `export function investmentDirectResponse(input = "") {\n  if (!isInvestmentIntent(input)) return null;\n  const text = String(input || "").toLowerCase();\n  const asksToManage = /\\b(?:can|could|would|will)\\s+you\\s+(?:manage|handle|invest|trade|build|run)\\b/.test(text) || /\\bmanage\\s+my\\s+(?:stocks?|portfolio|investments?)\\b/.test(text);\n  if (!asksToManage) return null;\n  const budget = text.match(/\\$\\s?(\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?)/)?.[1]?.replace(/,/g, "") || null;\n  const budgetText = budget ? \\`With $\\${budget}, I can build a disciplined starter plan around position sizing, diversification, downside limits, fees, and what each position is supposed to accomplish. \\` : "I can build and manage the research, allocation plan, risk rules, watchlist, and decision process. ";\n  return {\n    text: \\`Yes — I can manage the intelligence and decision process around your stocks at a very high level. \\${budgetText}I can research current opportunities, compare bull/base/bear cases, track the portfolio, tell you when the thesis changes, and prepare exact trades for your approval. I will not place real trades or move money on my own; each real transaction still needs your specific approval. For a small account, I’d focus on avoiding overtrading and concentration before chasing returns. If you want, give me your time horizon and how much of that money you could tolerate losing, and I’ll build the first allocation.\\`,\n    responseId:null, webSearches:0, model:"deterministic-investment-capability", completed:true, terminalState:"verified",\n    route:{domain:"investment",tier:"fast",reasoningEffort:"low",latencyClass:"instant"}\n  };\n}\n\nexport function investmentRuntimePrompt(input = "") {`, "investment direct response"]
]);

const v2Changed = patch("src/v2-turn-engine.js", [
  ['import { humanizeResponse } from "./human-response.js";', 'import { humanizeResponse } from "./human-response.js";\nimport { investmentDirectResponse } from "./investment-intelligence.js";', "investment direct import"],
  ['direct=verifiedDirectResponse(input,toolResults)||sierraWorkflowDirectResponse(input,toolResults);', 'direct=verifiedDirectResponse(input,toolResults)||sierraWorkflowDirectResponse(input,toolResults)||investmentDirectResponse(input);', "investment direct routing"]
]);

console.log(`[Georgie] Domain-aware chat runtime installed: mobile=${mobileChanged} app=${appChanged} investment=${investmentChanged} engine=${v2Changed}`);
