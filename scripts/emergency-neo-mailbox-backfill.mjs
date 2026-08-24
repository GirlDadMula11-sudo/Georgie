import crypto from "node:crypto";
import { listNeoMailboxes, listMessagesBefore, readMessage } from "../src/integrations/neo-mail.js";
import { projectSierraMailboxEvidence } from "../src/integrations/sierra-workforce.js";

const enabled = String(process.env.GEORGIE_EMERGENCY_NEO_BACKFILL || "").trim() === "1";
if (!enabled) process.exit(0);

const OBJECTIVE = String(process.env.GEORGIE_EMERGENCY_NEO_OBJECTIVE || "SIERRA-LI-MBX-20260823-001").trim();
const PAGE_SIZE = Math.max(1, Math.min(Number(process.env.GEORGIE_EMERGENCY_NEO_PAGE_SIZE || 100), 100));
const MAX_PAGES = Math.max(1, Math.min(Number(process.env.GEORGIE_EMERGENCY_NEO_MAX_PAGES || 250), 1000));
const START_WORK_UID = Number(process.env.GEORGIE_EMERGENCY_NEO_WORK_BEFORE_UID || 47569);
const START_SUBMISSIONS_UID = Number(process.env.GEORGIE_EMERGENCY_NEO_SUBMISSIONS_BEFORE_UID || 12315);
const outcomePattern = /\b(approved?|offer(?:ed)?|declin(?:e|ed)|denied|funded|funding|stip(?:ulation)?s?|conditions?|term sheet|payoff|renewal)\b/i;
const lenderPattern = /\b(dexly|rapid finance|spartan|principis|smartstep|tvt|essentia|iou|kapitus|smartbiz|velocity|bizfund|loan23|zlur|e capital|lima one|kiavi|loanbuilder|national funding|fundbox|ondeck|fundworks|fundkite|credibly|libertas|itria|mulligan|cfg|capflow|avana|idea financial)\b/i;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (value, max = 1200) => String(value ?? "").trim().slice(0, max);

function redact(text) {
  return clean(String(text || "")
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, "[REDACTED_SSN]")
    .replace(/\b\d{2}-?\d{7}\b/g, "[REDACTED_EIN]")
    .replace(/\b\d{8,17}\b/g, "[REDACTED_FINANCIAL_NUMBER]"), 1200);
}

function classify(corpus) {
  if (/\bfunded|funding complete\b/i.test(corpus)) return "funding";
  if (/\bdeclin(?:e|ed)|denied\b/i.test(corpus)) return "decline";
  if (/\bapproved?|offer(?:ed)?|term sheet\b/i.test(corpus)) return "offer_or_approval";
  if (/\bstip(?:ulation)?s?|conditions?\b/i.test(corpus)) return "stipulation";
  return "lender_communication";
}

async function collectEvidence(mailboxEmail, page) {
  const evidence = [];
  for (const row of page.messages) {
    const headerCorpus = `${row.subject || ""} ${row.from || ""}`;
    if (!outcomePattern.test(headerCorpus) && !lenderPattern.test(headerCorpus)) continue;
    try {
      const message = await readMessage(mailboxEmail, row.uid, { markSeen: false });
      const corpus = `${message.subject || ""}\n${message.from || ""}\n${message.text || ""}`;
      if (!outcomePattern.test(corpus) && !lenderPattern.test(corpus)) continue;
      const amountRaw = corpus.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1] || null;
      const canonical = {
        mailbox: mailboxEmail.toLowerCase(),
        uid: message.uid,
        messageId: message.messageId || null,
        date: message.date || row.date || null,
        from: clean(message.from, 500),
        subject: clean(message.subject, 1000),
        classification: classify(corpus),
        amount: amountRaw ? Number(amountRaw.replace(/,/g, "")) : null,
        bodyExcerpt: redact(message.text)
      };
      evidence.push({ ...canonical, canonicalHash: digest(canonical) });
    } catch (error) {
      console.warn(`[Emergency NEO] read failed mailbox=${mailboxEmail} uid=${row.uid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return evidence;
}

async function runMailbox(mailbox, beforeUid) {
  let cursor = Number.isFinite(beforeUid) ? beforeUid : null;
  let pageNumber = 0;
  let totalScanned = 0;
  let totalEvidence = 0;
  let exhausted = false;
  while (!exhausted && pageNumber < MAX_PAGES) {
    pageNumber += 1;
    const page = await listMessagesBefore(mailbox.email, { beforeUid: cursor, limit: PAGE_SIZE });
    totalScanned += page.messages.length;
    const evidence = await collectEvidence(mailbox.email, page);
    totalEvidence += evidence.length;
    const receiptId = `render-emergency:${OBJECTIVE}:${mailbox.id}:${cursor ?? "latest"}:${page.nextBeforeUid ?? "end"}`;
    if (evidence.length) {
      const idempotencyKey = `render-emergency:${mailbox.id}:${cursor ?? "latest"}:${page.nextBeforeUid ?? "end"}`;
      await projectSierraMailboxEvidence(process.env.GEORGIE_PRIMARY_USER_ID || "primary", {
        objectiveId: OBJECTIVE,
        idempotencyKey,
        receipts: [{ receiptId, commandId: `render-emergency-${mailbox.id}`, createdAt: new Date().toISOString(), responseHash: digest(evidence) }],
        evidence
      });
    }
    console.log(`[Emergency NEO] mailbox=${mailbox.email} page=${pageNumber} scanned=${page.messages.length} evidence=${evidence.length} nextBeforeUid=${page.nextBeforeUid ?? "null"} exhausted=${page.exhausted}`);
    exhausted = Boolean(page.exhausted || page.nextBeforeUid == null || page.messages.length === 0);
    cursor = page.nextBeforeUid;
  }
  return { mailbox: mailbox.email, pages: pageNumber, scanned: totalScanned, evidence: totalEvidence, nextBeforeUid: cursor, exhausted };
}

try {
  const mailboxes = listNeoMailboxes();
  const work = mailboxes.find(item => item.role === "executive_work" || item.id === "work");
  const submissions = mailboxes.find(item => item.role === "lender_submissions" || item.id === "submissions");
  if (!work || !submissions) throw new Error("Required NEO work/submissions mailboxes are not configured");
  const results = await Promise.all([
    runMailbox(work, START_WORK_UID),
    runMailbox(submissions, START_SUBMISSIONS_UID)
  ]);
  console.log(`[Emergency NEO] COMPLETE ${JSON.stringify(results)}`);
} catch (error) {
  console.error(`[Emergency NEO] FAILED ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
}
