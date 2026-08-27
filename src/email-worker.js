import { analyzeOperationalEmail } from "./georgie.js";
import { enqueueEvent } from "./events.js";
import { createTask } from "./tasks.js";
import { listNeoMailboxes, listRecentMessages, neoMailConfigured, readMessage, readMessageForProcessing } from "./integrations/neo-mail.js";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { runConnectionCertification } from "./connection-certifier.js";
import { buildEmailOperatingModel } from "./email-learning.js";
import { processSierraInboundCorrespondence } from "./client-correspondence.js";

let timer=null;let running=false;let startupChecksStarted=false;const NS="email_state";const USER=()=>process.env.GEORGIE_PRIMARY_USER_ID||"primary";
const RETRY_BASE_MS=5*60_000,RETRY_CAP_MS=6*60*60_000;
export function neoRetryDelayMs(attempts){return Math.min(RETRY_CAP_MS,RETRY_BASE_MS*2**Math.max(0,Math.min(12,Number(attempts||1)-1)));}
export function neoRetryDue(failure,at=Date.now()){const next=new Date(failure?.nextAttemptAt||0).getTime();return !Number.isFinite(next)||next<=at;}
export function recordNeoFailure(failures,mailboxId,uid,error,at=Date.now()){
  failures[mailboxId]||={};const key=String(uid),prior=failures[mailboxId][key]||{},attempts=Number(prior.attempts||0)+1;
  failures[mailboxId][key]={attempts,lastAttemptAt:new Date(at).toISOString(),nextAttemptAt:new Date(at+neoRetryDelayMs(attempts)).toISOString(),lastError:String(error||"unknown error").slice(0,500)};
  return failures[mailboxId][key];
}
async function readState(){const s=await readCloudState(USER(),NS,{processed:{},failures:{}});return{processed:s.processed&&typeof s.processed==="object"?s.processed:{},failures:s.failures&&typeof s.failures==="object"?s.failures:{}};}
async function writeState(state){await writeCloudState(USER(),NS,state);}
function safeDueAt(value){if(!value)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;}
function emailDomain(mailbox,triage){if(mailbox.id==="submissions"||mailbox.role==="lender_submissions"||mailbox.role==="georgie_closer"||mailbox.role==="client_correspondence")return"sierra";const proposed=String(triage.domain||"uncertain");return["personal","household","sierra","uncertain"].includes(proposed)?proposed:"uncertain";}
function correspondenceComplete(result){if(!result?.matched)return false;const c=result.completion||{};return c.inboundProviderReceipt===true&&c.crmReadBack===true&&c.documentReadBack===true&&c.internalNotificationReadBack===true&&(!result.outbound||(c.outboundProviderReceipt===true&&c.outboundCrmReadBack===true));}
async function processMailbox(mailbox,state){
  const userId=USER();
  const recent=await listRecentMessages(mailbox.id,{limit:Number(process.env.GEORGIE_EMAIL_SCAN_LIMIT||20),unseenOnly:true});
  state.processed[mailbox.id]||={};state.failures[mailbox.id]||={};
  const failureBudget=Math.max(1,Math.min(10,Number(process.env.GEORGIE_EMAIL_FAILURE_BUDGET||3)));let failuresThisCycle=0;
  for(const item of recent.reverse()){
    const key=String(item.uid);if(state.processed[mailbox.id][key]||!neoRetryDue(state.failures[mailbox.id][key]))continue;
    try{
      const preview=await readMessage(mailbox.id,item.uid,{markSeen:false});
      const triage=await analyzeOperationalEmail(preview);
      const domain=emailDomain(mailbox,triage);
      const priority=["low","normal","high","urgent"].includes(triage.priority)?triage.priority:"normal";
      const summary=String(triage.summary||preview.subject||"Email received").slice(0,1500);
      const action=String(triage.action||"").slice(0,2000);
      const suggestedReply=String(triage.suggestedReply||"").slice(0,4000);
      const dueAt=safeDueAt(triage.dueAt);
      const evidence={mailboxId:mailbox.id,uid:item.uid,messageId:preview.messageId||null,from:preview.from,subject:preview.subject,date:preview.date,domainEvidence:Array.isArray(triage.domainEvidence)?triage.domainEvidence.slice(0,8):[],confidence:Number(triage.confidence||0)};

      let correspondence=null;
      if(domain==="sierra"){
        const full=await readMessageForProcessing(mailbox.id,item.uid);
        correspondence=await processSierraInboundCorrespondence(userId,{message:full,triage});
        if(correspondence?.matched&&!correspondenceComplete(correspondence))throw new Error("Sierra correspondence did not satisfy the completion contract");
        if(correspondence?.matched){
          evidence.sierraReference=correspondence.reference;
          evidence.crmReadBack=true;
          evidence.documentCount=Number(correspondence.ingestion?.verification?.document_count||0);
          evidence.notificationReadBack=true;
          evidence.automaticReplySent=Boolean(correspondence.outbound);
          if((correspondence.ingestion?.rejected||[]).length){
            await createTask({userId,title:`Review rejected NEO attachment(s): ${correspondence.reference}`,notes:(correspondence.ingestion.rejected||[]).map(row=>`${row.filename||"attachment"}: ${row.error}`).join("\n"),priority:"high",domain:"sierra",evidence,source:`neo-attachment-review:${mailbox.id}:${item.uid}`});
          }
          await enqueueEvent({userId,type:"email.sierra_completed",title:`Georgie completed Sierra correspondence: ${correspondence.reference}`,body:`CRM read-back confirmed. ${evidence.documentCount} document(s) registered.${evidence.automaticReplySent?" Automatic client reply sent and recorded.":""}`,priority:evidence.automaticReplySent?"normal":priority,dedupeKey:`neo-sierra-complete:${mailbox.id}:${item.uid}`,data:{reference:correspondence.reference,evidence,completion:correspondence.completion,openDocumentRequests:correspondence.openRequests?.length||0}});
        }
      }

      const actionAlreadyCompleted=Boolean(correspondence?.matched&&correspondence?.outbound);
      if(triage.requiresAction&&!actionAlreadyCompleted)await createTask({userId,title:action||`Respond to: ${preview.subject||preview.from||"email"}`,notes:[`Domain: ${domain}`,`Mailbox: ${mailbox.label||mailbox.email}`,`From: ${preview.from||"unknown"}`,`Subject: ${preview.subject||""}`,`Summary: ${summary}`,correspondence?.matched?`Sierra CRM updated: ${correspondence.reference}`:"",suggestedReply?`Draft only — suggested reply: ${suggestedReply}`:""].filter(Boolean).join("\n"),dueAt,priority,domain,evidence,source:`neo-mail:${mailbox.id}:${item.uid}`});
      if(priority==="high"||priority==="urgent"||triage.requiresAction)await enqueueEvent({userId,type:"email.triage",title:priority==="urgent"?`Urgent email: ${preview.subject||preview.from}`:`Email needs attention: ${preview.subject||preview.from}`,body:summary,priority,dedupeKey:`neo:${mailbox.id}:${item.uid}`,data:{domain,evidence,mailboxId:mailbox.id,uid:item.uid,from:preview.from,subject:preview.subject,category:triage.category||"other",requiresAction:Boolean(triage.requiresAction&&!actionAlreadyCompleted),action,dueAt,suggestedReply,confidence:Number(triage.confidence||0),correspondenceCompleted:Boolean(correspondence?.matched&&correspondenceComplete(correspondence))}});

      state.processed[mailbox.id][key]={at:new Date().toISOString(),domain,priority,category:triage.category||"other",requiresAction:Boolean(triage.requiresAction&&!actionAlreadyCompleted),evidence,correspondence:correspondence?.matched?{reference:correspondence.reference,completed:correspondenceComplete(correspondence),automaticReplySent:Boolean(correspondence.outbound),documentCount:Number(correspondence.ingestion?.verification?.document_count||0)}:null};
      delete state.failures[mailbox.id][key];
      const keys=Object.keys(state.processed[mailbox.id]);if(keys.length>2000)for(const oldKey of keys.slice(0,keys.length-1500))delete state.processed[mailbox.id][oldKey];
    }catch(error){recordNeoFailure(state.failures,mailbox.id,item.uid,error instanceof Error?error.message:error);failuresThisCycle+=1;if(failuresThisCycle>=failureBudget)break;}
  }
  const failedKeys=Object.keys(state.failures[mailbox.id]);if(failedKeys.length>2000)for(const oldKey of failedKeys.slice(0,failedKeys.length-1500))delete state.failures[mailbox.id][oldKey];
  if(failuresThisCycle)console.warn(`Neo Mail ${mailbox.id} deferred ${failuresThisCycle} message(s) with durable backoff`);
}
export async function sweepNeoMail(){if(running||!neoMailConfigured())return;running=true;try{const state=await readState();for(const mailbox of listNeoMailboxes()){await processMailbox(mailbox,state);await writeState(state);}}catch(error){console.warn("Neo Mail sweep failed:",error instanceof Error?error.message:error);}finally{running=false;}}
async function runStartupIntelligence(){if(startupChecksStarted)return;startupChecksStarted=true;try{await runConnectionCertification();}catch(error){console.warn("Connection certification failed:",error instanceof Error?error.message:error);}try{await buildEmailOperatingModel();}catch(error){console.warn("Email operating-model learning failed:",error instanceof Error?error.message:error);}}
export function startEmailIntelligence(){if(timer||!neoMailConfigured())return;const intervalMs=Math.max(15000,Number(process.env.GEORGIE_EMAIL_POLL_MS||30000));void runStartupIntelligence();sweepNeoMail();timer=setInterval(sweepNeoMail,intervalMs);timer.unref?.();}
export function stopEmailIntelligence(){if(timer)clearInterval(timer);timer=null;}
