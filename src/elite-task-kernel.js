import crypto from "node:crypto";
import { enqueueHandoff } from "./shared-mission.js";

const RULES=[
  ["technical",/\b(code|bug|api|database|deploy|server|worker|queue|auth|github|render|vercel|supabase|crm|integration|software|website)\b/i],
  ["sierra",/\b(sierra|crm|capitalmatch|cm-?100|lender|underwriting|partner portal|capitalapply|merchant|bank statement)\b/i],
  ["research",/\b(research|compare|investigate|verify|current|latest|source|evidence)\b/i],
  ["communication",/\b(email|message|reply|write|draft|call|notify|send)\b/i],
  ["personal",/\b(personal|family|daughter|travel|trip|home|household|calendar|appointment)\b/i],
  ["financial",/\b(pay|purchase|transfer|invest|trade|bank account|credit|loan|price|budget)\b/i],
  ["medical",/\b(health|medical|doctor|symptom|medicine|diagnosis|treatment)\b/i],
  ["legal",/\b(legal|lawyer|court|contract|lawsuit|compliance|regulation)\b/i],
  ["creative",/\b(design|image|video|music|song|brand|creative|presentation)\b/i]
];
const ACTIONS={
  destructive:/\b(delete|erase|drop|purge|destroy|wipe|terminate)\b/i,
  production:/\b(production|deploy|merge|main branch|live database|schema|migration)\b/i,
  credential:/\b(password|credential|api key|secret|mfa|authentication setting)\b/i,
  external:/\b(send|submit|publish|contact|email|message|notify|post)\b/i,
  financial:/\b(pay|purchase|transfer|invest|trade|borrow|spend)\b/i
};
const CURRENT=/\b(latest|current|today|now|live|price|status|availability|law|regulation|medical|recommend)\b/i;
const MULTISTEP=/\b(and then|after that|across|every|entire|whole|end[- ]to[- ]end|all|multiple|first|finally)\b/i;

function clean(value,max=4000){return String(value||"").trim().replace(/\s+/g," ").slice(0,max);}
function domainsFor(text){const found=RULES.filter(([,pattern])=>pattern.test(text)).map(([domain])=>domain);return found.length?[...new Set(found)]:["general"];}
function actionsFor(text){return Object.entries(ACTIONS).filter(([,pattern])=>pattern.test(text)).map(([name])=>name);}
function authority(actions){if(actions.includes("destructive"))return"explicit_transaction_approval";if(actions.some(action=>["production","credential","external","financial"].includes(action)))return"governed_approval";return"automatic_safe_work";}
function evidence(domains,actions,current){const required=["acceptance criteria","current tool receipts for actions","durable terminal state"];
  if(current)required.push("fresh timestamped authoritative sources");
  if(domains.includes("technical"))required.push("reproduction, regression test, rollback evidence");
  if(domains.includes("sierra"))required.push("canonical record IDs and cross-system reconciliation");
  if(domains.some(domain=>["financial","medical","legal"].includes(domain)))required.push("high-stakes source verification and explicit uncertainty");
  if(actions.includes("external"))required.push("recipient, exact payload, provider acknowledgement, idempotency receipt");
  return[...new Set(required)];
}
export function eliteTaskContract(input={}){
  const objective=clean(typeof input==="string"?input:input.objective);if(!objective)throw new Error("A task objective is required");
  const domains=domainsFor(objective),actions=actionsFor(objective),current=CURRENT.test(objective),complex=MULTISTEP.test(objective)||domains.length>=3||objective.length>300;
  const risk=actions.includes("destructive")?"critical":actions.some(action=>["production","credential","financial"].includes(action))?"high":actions.includes("external")||domains.some(domain=>["medical","legal"].includes(domain))?"elevated":"bounded";
  const contract={id:`task-${crypto.createHash("sha256").update(objective.toLowerCase()).digest("hex").slice(0,16)}`,version:1,objective,domains,actions,risk,authority:authority(actions),reasoningTier:complex||risk==="high"||risk==="critical"?"frontier":current||domains.length>1?"standard":"efficient",requiresFreshResearch:current,backgroundEligible:!actions.includes("financial")&&!actions.includes("credential"),workflow:["orient","retrieve current evidence","decompose dependencies","execute allowed steps","verify acceptance criteria","recover or rollback","report plainly","retain learning"],requiredEvidence:evidence(domains,actions,current),completionRule:"Do not mark complete until every acceptance criterion has current evidence and every consequential action has a terminal receipt.",failureRule:"Persist unfinished work with the exact failed prerequisite; never replace execution with narration."};
  return contract;
}
export function verifyEliteTask(contract,outcome={}){
  const evidence=Array.isArray(outcome.evidence)?outcome.evidence:[],criteria=Array.isArray(outcome.acceptanceCriteria)?outcome.acceptanceCriteria:[],receipts=Array.isArray(outcome.receipts)?outcome.receipts:[];
  const missing=[];if(!criteria.length||criteria.some(item=>item?.passed!==true))missing.push("acceptance_criteria");if(evidence.length<contract.requiredEvidence.length)missing.push("required_evidence");if(contract.actions.length&&!receipts.some(item=>item?.terminal===true))missing.push("terminal_action_receipt");if(outcome.authoritative!==true)missing.push("authoritative_source_confirmation");
  return{verified:missing.length===0,terminalState:missing.length?"incomplete":"completed",missing,mayLearn:missing.length===0&&outcome.quarantined!==true};
}
export async function startEliteTask(userId,input={}){const contract=eliteTaskContract(input);const acceptanceCriteria=Array.isArray(input.acceptanceCriteria)&&input.acceptanceCriteria.length?input.acceptanceCriteria:contract.requiredEvidence.map(value=>`Provide ${value}`);const queued=await enqueueHandoff(userId,{source:"elite_task_kernel",type:contract.domains.includes("technical")?"engineering":"verification",priority:Math.max(1,Math.min(100,Number(input.priority)||70)),objective:contract.objective,scope:{contract},acceptanceCriteria,evidence:input.evidence||{},requestedAuthority:contract.authority,dedupeKey:input.dedupeKey||contract.id});return{contract,handoff:queued};}
export function eliteTaskRuntimePrompt(input){const contract=eliteTaskContract(input);return `ELITE TASK CONTRACT\n${JSON.stringify(contract)}\nUse this as a planning and verification contract, not as evidence that any action ran.`;}
