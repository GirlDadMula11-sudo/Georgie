import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";
import { MALWARE_CONTRACT } from "./financing-recovery-adapters.js";

const clean = (v, max = 1000) => String(v ?? "").trim().slice(0, max);
const normalizeBusiness = v => clean(v, 240).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(?:llc|inc|incorporated|corp|corporation|ltd|limited|company|co|pllc|llp)\b/g, " ").replace(/\s+/g, " ").trim();
const monthNames = { january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",jan:"01",feb:"02",mar:"03",apr:"04",jun:"06",jul:"07",aug:"08",sep:"09",sept:"09",oct:"10",nov:"11",dec:"12" };

async function inspectPdf(buffer, includeText = false) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const info = await parser.getInfo();
    const total = Number(info?.total || info?.pages?.length || 0);
    if (!Number.isInteger(total) || total < 1 || total > 80) throw new Error("RECOVERY_PDF_STRUCTURE_INVALID");
    if (!includeText) return { numpages: total, text: "" };
    const result = await parser.getText({ first: 1, last: total });
    return { numpages: Number(result?.total || total), text: String(result?.text || "") };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function supabaseConfig(env = process.env) {
  const url = clean(env.GEORGIE_SUPABASE_URL, 1000).replace(/\/$/, "");
  const key = clean(env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY, 12000);
  if (!url || !key) throw new Error("RECOVERY_VALIDATOR_STORE_NOT_CONFIGURED");
  return { url, headers: { apikey: key, authorization: `Bearer ${key}` } };
}

function detectMonth(text) {
  const sample = clean(text, 120000);
  let m = /(?:statement\s*(?:period|date|month)|through|ending|as\s+of)\D{0,30}(0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])[\/-](20\d{2})/i.exec(sample);
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
  m = /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\D{0,12}(?:\d{1,2}\D{0,6})?(20\d{2})/i.exec(sample);
  if (m) return `${m[2]}-${monthNames[m[1].toLowerCase()]}`;
  m = /\b(20\d{2})[-_/](0[1-9]|1[0-2])\b/.exec(sample);
  return m ? `${m[1]}-${m[2]}` : "";
}

function requestedValue(requestedMonths, detected) {
  if (!detected) return "";
  return (requestedMonths || []).find(v => String(v).slice(0, 7) === detected) || "";
}

function activePdfTokens(buffer) {
  const raw = buffer.toString("latin1");
  return ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia", "/OpenAction", "/AA", "/AcroForm", "/XFA"].filter(token => raw.includes(token));
}

export function createNativeRecoveryDocumentScanner() {
  return {
    contract: MALWARE_CONTRACT,
    async scan({ buffer, contentHash }) {
      if (!Buffer.isBuffer(buffer) || buffer.length < 32 || buffer.length > 10 * 1024 * 1024) throw new Error("RECOVERY_DOCUMENT_SIZE_INVALID");
      const computed = crypto.createHash("sha256").update(buffer).digest("hex");
      if (computed !== contentHash) throw new Error("RECOVERY_DOCUMENT_HASH_MISMATCH");
      const isPdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9;
      const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
      if (!isPdf && !isJpeg && !isPng) throw new Error("RECOVERY_DOCUMENT_SIGNATURE_INVALID");
      if (isPdf) {
        const active = activePdfTokens(buffer);
        if (active.length) throw new Error(`RECOVERY_PDF_ACTIVE_CONTENT_BLOCKED:${active.join(",")}`);
        await inspectPdf(buffer, false);
      }
      return { clean: true, receiptId: `native-safety:${contentHash}`, engine: "sierra-passive-document-safety-v2" };
    }
  };
}

async function readJson(url, headers, signal) {
  const response = await fetch(url, { headers, signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`RECOVERY_VALIDATOR_STORE_${response.status}`);
  return body;
}

export function createNativeRecoveryStatementValidator({ env = process.env } = {}) {
  return async function validate({ buffer, contentHash, requestedMonths, applicantId }) {
    if (!Array.isArray(requestedMonths) || !requestedMonths.length || !applicantId) throw new Error("RECOVERY_STATEMENT_SCOPE_REQUIRED");
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("RECOVERY_STATEMENT_NATIVE_TEXT_REQUIRED");
    const { url, headers } = supabaseConfig(env);
    const existing = await readJson(`${url}/rest/v1/georgie_recovery_evidence?select=id,status&content_hash=eq.${encodeURIComponent(contentHash)}&limit=1`, headers, AbortSignal.timeout(7000));
    if (Array.isArray(existing) && existing.some(row => row?.status === "quarantined")) throw new Error("RECOVERY_DUPLICATE_QUARANTINED");
    const parsed = await inspectPdf(buffer, true);
    const text = clean(parsed.text, 120000);
    if (text.length < 100) throw new Error("RECOVERY_STATEMENT_TEXT_INSUFFICIENT");
    const detected = detectMonth(text);
    const statementMonth = requestedValue(requestedMonths, detected);
    if (!statementMonth) throw new Error("RECOVERY_STATEMENT_MONTH_NOT_REQUESTED");
    const dossiers = await readJson(`${url}/rest/v1/georgie_rehash_merchant_dossiers?select=id,merchant_name&merchant_id=eq.${encodeURIComponent(applicantId)}&order=created_at.desc&limit=1`, headers, AbortSignal.timeout(7000));
    const business = normalizeBusiness(dossiers?.[0]?.merchant_name);
    const normalizedText = normalizeBusiness(text);
    const meaningful = business.split(" ").filter(x => x.length >= 4);
    const matched = Boolean(business && meaningful.length && meaningful.filter(x => normalizedText.includes(x)).length >= Math.min(2, meaningful.length));
    if (!matched) throw new Error("RECOVERY_STATEMENT_BUSINESS_MISMATCH");
    return { applicantId, businessMatch: true, statementMonth, confidence: .96, evidenceIds: [`native-statement:${contentHash}`], extractionEngine: "sierra-recovery-statement-identity-v2", duplicate: Array.isArray(existing) && existing.length > 0, verified: true };
  };
}

export function createProductionRecoveryUploadAdapters() {
  const scanner = createNativeRecoveryDocumentScanner();
  const validator = createNativeRecoveryStatementValidator();
  return { scanner, scan: scanner.scan.bind(scanner), validateDocument: validator };
}
