import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listNeoMailboxes, listMessagesBefore, readMessage } from "../src/integrations/neo-mail.js";
import { projectSierraMailboxEvidence } from "../src/integrations/sierra-workforce.js";

const enabled = String(process.env.GEORGIE_EMERGENCY_NEO_BACKFILL || "").trim() === "1";
if (!enabled) process.exit(0);
const OBJECTIVE = String(process.env.GEORGIE_EMERGENCY_NEO_OBJECTIVE || "SIERRA-LI-MBX-20260823-001").trim();
const PAGE_SIZE = Math.max(1, Math.min(Number(process.env.GEORGIE_EMERGENCY_NEO_PAGE_SIZE || 100), 100));
const MAX_PAGES = Math.max(1, Math.min(Number(process.env.GEORGIE_EMERGENCY_NEO_MAX_PAGES || 1000), 1000));
const READ_CONCURRENCY = Math.max(1, Math.min(Number(process.env.GEORGIE_EMERGENCY_NEO_READ_CONCURRENCY || 6), 10));
const START_WORK_UID = Number(process.env.GEORGIE_EMERGENCY_NEO_WORK_BEFORE_UID || 25582);
const START_SUBMISSIONS_UID = Number(process.env.GEORGIE_EMERGENCY_NEO_SUBMISSIONS_BEFORE_UID || 1393);
const DATA_DIR = path.resolve(process.env.GEORGIE_DATA_DIR || "data");
const CHECKPOINT_DIR = path.join(DATA_DIR, "neo-backfill", OBJECTIVE.replace(/[^a-zA-Z0-9._-]/g, "_"));
fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });

const checkpointPath = mailboxId => path.join(CHECKPOINT_DIR, `${String(mailboxId).replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
const leasePath = mailboxId => `${checkpointPath(mailboxId)}.lease`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function readCheckpoint(mailboxId) {
  try { return JSON.parse(fs.readFileSync(checkpointPath(mailboxId), "utf8")); }
  catch { return null; }
}
function writeCheckpoint(mailboxId, value) {
  const target = checkpointPath(mailboxId);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, target);
}
async function acquireLease(mailboxId) {
  const target = leasePath(mailboxId);
  for (;;) {
    try {
      const fd = fs.openSync(target, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      fs.closeSync(fd);
      const heartbeat = setInterval(() => { try { const now = new Date(); fs.utimesSync(target, now, now); } catch {} }, 5000);
      heartbeat.unref?.();
      return () => { clearInterval(heartbeat); try { fs.unlinkSync(target); } catch {} };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(target).mtimeMs;
        if (age > 20000) { fs.unlinkSync(target); continue; }
      } catch {}
      await sleep(3000);
    }
  }
}
const outcomePattern = /\b(approved?|offer(?:ed)?|declin(?:e|ed)|denied|funded|funding|stip(?:ulation)?s?|conditions?|term sheet|payoff|renewal)\b/i;
const lenderPattern = /\b(dexly|rapid finance|spartan|principis|smartstep|tvt|essentia|iou|kapitus|smartbiz|velocity|bizfund|loan23|zlur|e capital|lima one|kiavi|loanbuilder|national funding|fundbox|ondeck|fundworks|fundkite|credibly|libertas|itria|mulligan|cfg|capflow|avana|idea financial)\b/i;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (value, max = 1200) => String(value ?? "").trim().slice(0, max);
function redact(text) { return clean(String(text || "").replace(/\b\d{3}-?\d{2}-?\d{4}\b/g,"[REDACTED_SSN]").replace(/\b\d{2}-?\d{7}\b/g,"[REDACTED_EIN]").replace(/\b\d{8,17}\b/g,"[REDACTED_FINANCIAL_NUMBER]"),1200); }
function classify(corpus) { if (/\bfunded|funding complete\b/i.test(corpus)) return "funding"; if (/\bdeclin(?:e|ed)|denied\b/i.test(corpus)) return "decline"; if (/\bapproved?|offer(?:ed)?|term sheet\b/i.test(corpus)) return "offer_or_approval"; if (/\bstip(?:ulation)?s?|conditions?\b/i.test(corpus)) return "stipulation"; return "lender_communication"; }
async function evidenceForRow(mailboxEmail,row){
  try {
    const message=await readMessage(mailboxEmail,row.uid,{markSeen:false});
    const corpus=`${message.subject||""}\n${message.from||""}\n${message.text||""}`;
    if(!outcomePattern.test(corpus)&&!lenderPattern.test(corpus)) return null;
    const amountRaw=corpus.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1]||null;
    const canonical={mailbox:mailboxEmail.toLowerCase(),uid:message.uid,messageId:message.messageId||null,date:message.date||row.date||null,from:clean(message.from,500),subject:clean(message.subject,1000),classification:classify(corpus),amount:amountRaw?Number(amountRaw.replace(/,/g,"")):null,bodyExcerpt:redact(message.text)};
    return {...canonical,canonicalHash:digest(canonical)};
  } catch(error){ console.warn(`[Emergency NEO] read failed mailbox=${mailboxEmail} uid=${row.uid}: ${error instanceof Error?error.message:String(error)}`); return null; }
}
async function collectEvidence(mailboxEmail,page){
  const candidates=page.messages.filter(row=>{const h=`${row.subject||""} ${row.from||""}`;return outcomePattern.test(h)||lenderPattern.test(h);});
  const evidence=[];
  for(let i=0;i<candidates.length;i+=READ_CONCURRENCY){
    const rows=candidates.slice(i,i+READ_CONCURRENCY);
    const batch=await Promise.all(rows.map(row=>evidenceForRow(mailboxEmail,row)));
    evidence.push(...batch.filter(Boolean));
  }
  return evidence;
}
async function runMailbox(mailbox,beforeUid){
  const releaseLease = await acquireLease(mailbox.id);
  try {
  const saved = readCheckpoint(mailbox.id);
  const seed = Number.isFinite(beforeUid) ? beforeUid : null;
  const savedCursor = Number(saved?.nextBeforeUid);
  let cursor = Number.isFinite(savedCursor) ? (seed == null ? savedCursor : Math.min(seed, savedCursor)) : seed;
  let pageNumber=0,totalScanned=Number(saved?.scanned||0),totalEvidence=Number(saved?.evidence||0),exhausted=Boolean(saved?.exhausted);
  if (exhausted) return {mailbox:mailbox.email,pages:0,scanned:totalScanned,evidence:totalEvidence,nextBeforeUid:cursor,exhausted:true,resumed:true};
  console.log(`[Emergency NEO] RESUME mailbox=${mailbox.email} nextBeforeUid=${cursor??"latest"} priorScanned=${totalScanned} priorEvidence=${totalEvidence}`);
  while(!exhausted&&pageNumber<MAX_PAGES){
    pageNumber+=1;
    const page=await listMessagesBefore(mailbox.email,{beforeUid:cursor,limit:PAGE_SIZE});
    totalScanned+=page.messages.length;
    const evidence=await collectEvidence(mailbox.email,page); totalEvidence+=evidence.length;
    const receiptId=`render-emergency:${OBJECTIVE}:${mailbox.id}:${cursor??"latest"}:${page.nextBeforeUid??"end"}`;
    if(evidence.length){
      const idempotencyKey=`render-emergency:${mailbox.id}:${cursor??"latest"}:${page.nextBeforeUid??"end"}`;
      await projectSierraMailboxEvidence(process.env.GEORGIE_PRIMARY_USER_ID||"primary",{objectiveId:OBJECTIVE,idempotencyKey,receipts:[{receiptId,commandId:`render-emergency-${mailbox.id}`,createdAt:new Date().toISOString(),responseHash:digest(evidence)}],evidence});
    }
    console.log(`[Emergency NEO] mailbox=${mailbox.email} page=${pageNumber} scanned=${page.messages.length} evidence=${evidence.length} nextBeforeUid=${page.nextBeforeUid??"null"} exhausted=${page.exhausted}`);
    exhausted=Boolean(page.exhausted||page.nextBeforeUid==null||page.messages.length===0); cursor=page.nextBeforeUid;
    writeCheckpoint(mailbox.id,{objectiveId:OBJECTIVE,mailbox:mailbox.email,nextBeforeUid:cursor,exhausted,scanned:totalScanned,evidence:totalEvidence,updatedAt:new Date().toISOString()});
  }
  const result={mailbox:mailbox.email,pages:pageNumber,scanned:totalScanned,evidence:totalEvidence,nextBeforeUid:cursor,exhausted};
  writeCheckpoint(mailbox.id,{objectiveId:OBJECTIVE,...result,updatedAt:new Date().toISOString(),terminal:exhausted});
  return result;
  } finally { releaseLease(); }
}
try{
  const mailboxes=listNeoMailboxes();
  const work=mailboxes.find(item=>item.role==="executive_work"||item.id==="work");
  const submissions=mailboxes.find(item=>item.role==="lender_submissions"||item.id==="submissions");
  if(!work||!submissions) throw new Error("Required NEO work/submissions mailboxes are not configured");
  const results=await Promise.all([runMailbox(work,START_WORK_UID),runMailbox(submissions,START_SUBMISSIONS_UID)]);
  console.log(`[Emergency NEO] COMPLETE ${JSON.stringify(results)}`);
}catch(error){console.error(`[Emergency NEO] FAILED ${error instanceof Error?error.stack||error.message:String(error)}`);process.exitCode=1;}
