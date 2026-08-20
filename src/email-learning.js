import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readCloudState, writeCloudState } from "./cloud-state.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const USER = () => process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const NS = "jason_operating_model";

function mailboxDefs() {
  return [
    { id: "work", email: process.env.GEORGIE_NEO_WORK_EMAIL, password: process.env.GEORGIE_NEO_WORK_PASSWORD },
    { id: "submissions", email: process.env.GEORGIE_NEO_SUBMISSIONS_EMAIL, password: process.env.GEORGIE_NEO_SUBMISSIONS_PASSWORD }
  ].filter((x) => x.email && x.password);
}
function stripHtml(html) { return String(html || "").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim(); }
async function callModel(instructions, input) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch(`${OPENAI_BASE_URL}/responses`, { method:"POST", headers:{ authorization:`Bearer ${key}`, "content-type":"application/json" }, body:JSON.stringify({ model:process.env.OPENAI_BALANCED_MODEL||"gpt-5.6-terra", instructions, input, reasoning:{ effort:"medium", context:"all_turns" }, text:{ verbosity:"low" } }), signal:AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Operating-model analysis failed (${response.status})`);
  const payload = await response.json();
  return String(payload.output_text || (payload.output||[]).flatMap((i)=>i.content||[]).find((c)=>c.type==="output_text")?.text || "").trim();
}
async function sentFolder(client) { const boxes=await client.list(); const special=boxes.find((b)=>b.specialUse==="\\Sent"); if(special?.path)return special.path; return boxes.find((b)=>/(^|\/)(sent|sent items|sent messages)$/i.test(String(b.path||"")))?.path||null; }
async function sampleSent(mailbox, limit=80) {
  const client=new ImapFlow({ host:process.env.GEORGIE_NEO_IMAP_HOST||"imap0001.neo.space", port:Number(process.env.GEORGIE_NEO_IMAP_PORT||993), secure:true, auth:{user:mailbox.email,pass:mailbox.password}, logger:false });
  const samples=[];
  try { await client.connect(); const folder=await sentFolder(client); if(!folder)return{mailbox:mailbox.id,folder:null,samples:[]}; const lock=await client.getMailboxLock(folder); try { const exists=client.mailbox?.exists||0; if(!exists)return{mailbox:mailbox.id,folder,samples:[]}; const start=Math.max(1,exists-Math.max(1,Math.min(limit,200))+1); for await (const msg of client.fetch(`${start}:*`,{uid:true,source:true,internalDate:true})) { if(!msg.source)continue; const parsed=await simpleParser(msg.source); const body=String(parsed.text||"").trim() || stripHtml(parsed.html); samples.push({uid:msg.uid,date:msg.internalDate?.toISOString?.()||parsed.date?.toISOString?.()||null,to:parsed.to?.text||"",cc:parsed.cc?.text||"",subject:parsed.subject||"",text:body.slice(0,6000)}); } } finally { lock.release(); } } finally { await client.logout().catch(()=>{}); }
  return { mailbox:mailbox.id, samples:samples.slice(-limit) };
}
async function outcomeEvidence(limit=200) {
  const base=String(process.env.GEORGIE_SUPABASE_URL||"").replace(/\/$/,""); const key=String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY||""); if(!base||!key)return[];
  const response=await fetch(`${base}/rest/v1/rpc/georgie_email_outcome_learning_evidence`,{method:"POST",headers:{"content-type":"application/json",apikey:key,authorization:`Bearer ${key}`},body:JSON.stringify({p_limit:limit}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)return[]; const data=await response.json(); return Array.isArray(data)?data:[];
}
export async function buildEmailOperatingModel() {
  if(process.env.GEORGIE_EMAIL_LEARNING_ENABLED!=="true")return{ok:false,skipped:"disabled"}; const defs=mailboxDefs(); if(!defs.length)return{ok:false,skipped:"neo_not_configured"};
  const prior=await readCloudState(USER(),NS,{}); const [sampled,outcomes]=await Promise.all([Promise.all(defs.map((m)=>sampleSent(m,Number(process.env.GEORGIE_EMAIL_LEARNING_SAMPLE||80)))),outcomeEvidence(Number(process.env.GEORGIE_EMAIL_OUTCOME_SAMPLE||200))]);
  const total=sampled.reduce((n,x)=>n+x.samples.length,0); if(!total)return{ok:false,skipped:"no_sent_mail_found"};
  const evidence=sampled.map((x)=>({mailbox:x.mailbox,messages:x.samples.map((m)=>({date:m.date,to:m.to,cc:m.cc,subject:m.subject,text:m.text}))}));
  const analysis=await callModel(`Build a behavior model for Sierra's owner from his own sent business email plus linked Sierra outcomes. Observation only: do not draft or send. Infer stable patterns, separate lender/partner/client/internal/vendor behavior, and distinguish style from tactics that correlate with real outcomes. Identify tone, brevity, negotiation, follow-up cadence, information requests, escalation, decision style, preferred wording, boundaries, operational heuristics, and which behaviors correlate with response/approval/funding versus decline/no-progress. Do not imply causation without evidence. Never infer sensitive personal attributes. Return concise JSON only with keys: communication_style, audience_playbooks, negotiation_patterns, followup_patterns, information_request_patterns, escalation_patterns, decision_patterns, preferred_phrasing, avoid_phrasing, operating_heuristics, outcome_correlations, confidence, evidence_count.`,JSON.stringify({priorModel:prior?.model||null,sentEvidence:evidence,outcomeEvidence:outcomes}));
  let model; try{model=JSON.parse(analysis.replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}catch{model={summary:analysis,confidence:0.5,evidence_count:total};}
  const state={mode:"observe_only",model,sampledMessages:total,outcomeEvidenceCount:outcomes.length,mailboxCounts:Object.fromEntries(sampled.map((x)=>[x.mailbox,x.samples.length])),lastLearnedAt:new Date().toISOString(),authorityLevel:"observe",canSend:false,canAutoReply:false};
  await writeCloudState(USER(),NS,state); console.log(`[Georgie] Email operating model learned: ${JSON.stringify({ok:true,sampledMessages:total,outcomeEvidenceCount:outcomes.length,mailboxCounts:state.mailboxCounts,authorityLevel:state.authorityLevel})}`); return{ok:true,...state};
}
