import { specialistExecutionPermit } from "./resource-governor.js";
import crypto from "crypto";
import { neoMailConfigured, selectGeorgieCorrespondenceMailbox, sendMessage } from "./integrations/neo-mail.js";
import { recordOutboundCorrespondence } from "./integrations/sierra-correspondence.js";
import { getSierraAuditEvents, getSierraDeal, getSierraOffers, getSierraPortfolio, sierraWorkforceConfigured } from "./integrations/sierra-workforce.js";

export const SIERRA_CLOSING_OUTREACH_CONTRACT = "georgie.sierra-closing-outreach.v1.1";
const USER_ID = process.env.GEORGIE_PRIMARY_USER_ID || "primary";
const POLL_MS = bounded(process.env.GEORGIE_SIERRA_CLOSER_POLL_MS, 30_000, 15_000, 300_000);
const MAX_PER_CYCLE = bounded(process.env.GEORGIE_SIERRA_CLOSER_BATCH_SIZE, 10, 1, 50);
const MAX_INSPECT_PER_CYCLE = bounded(process.env.GEORGIE_SIERRA_CLOSER_INSPECT_LIMIT, 20, 1, 50);
const TERMINAL = new Set(["funded", "declined", "withdrawn", "cancelled", "canceled", "closed", "lost"]);
let timer = null, running = false;

function bounded(value, fallback, min, max) { const n=Number(value); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback; }
function clean(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function rows(value) { if (Array.isArray(value)) return value; for (const key of ["deals", "portfolio", "items", "results", "offers", "events", "data"]) if (Array.isArray(value?.[key])) return value[key]; return []; }
function first(value, keys) { for (const key of keys) if (clean(value?.[key])) return clean(value[key]); return ""; }
function referenceOf(deal) { return first(deal, ["reference_number", "reference", "referral_id", "deal_id", "id"]); }
function statusOf(deal) { return first(deal, ["stage_status", "current_stage", "referral_status", "status"]).toLowerCase(); }
function clientEmailOf(deal) { return first(deal, ["client_email", "email", "owner_email", "applicant_email", "contact_email"]).toLowerCase(); }
function businessNameOf(deal) { return first(deal, ["legal_business_name", "business_name", "company_name", "merchant_name"]) || "Your business"; }
function firstNameOf(deal) { return first(deal, ["first_name", "owner_first_name", "contact_first_name", "applicant_first_name"]); }
function evidenceRefsOf(offer) { const raw=offer?.evidenceRefs||offer?.evidence_refs||offer?.source_event_ids||offer?.evidence_ids||[]; if(Array.isArray(raw))return raw.map(value=>clean(typeof value==="object"?value.id||value.ref:value,300)).filter(Boolean); return clean(raw,300)?[clean(raw,300)]:[]; }
function offerIdOf(offer) { return first(offer, ["offerId", "offer_id", "id", "lender_offer_id"]); }
function isVerifiedOffer(offer) { const state=first(offer,["verification_status","evidence_status","status"]).toLowerCase(); return (offer?.verified===true||state==="verified"||state==="authoritative")&&Boolean(offerIdOf(offer))&&evidenceRefsOf(offer).length>0; }
function offerSnapshot(offers) { const identities=offers.map(offer=>`${offerIdOf(offer)}:${evidenceRefsOf(offer).sort().join(",")}`).sort(); return crypto.createHash("sha256").update(identities.join("|")).digest("hex").slice(0,24); }
function eventMetadata(event) { return event?.metadata&&typeof event.metadata==="object"?event.metadata:{}; }
function alreadyRecorded(events,idempotencyKey) { return rows(events).some(event=>{const metadata=eventMetadata(event);return clean(event?.idempotency_key||metadata.idempotency_key,300)===idempotencyKey||(clean(event?.event_type||event?.type,120)==="georgie_verified_offer_closing_outreach"&&clean(metadata.offer_snapshot,80)===idempotencyKey.split(":").at(-1));}); }
function messageFor(deal) { const greeting=firstNameOf(deal)?`Hi ${firstNameOf(deal)},`:"Hello,"; return `${greeting}\n\nSierra has a financing update ready for your review. I’m reaching out immediately so we can go over the available path, address your questions, and keep your file moving.\n\nReply with the best time to connect, or tell me the most important outcome you want from the financing so I can prepare the discussion around it.\n\nBest,\nGeorgie\nSierra Marketing Inc.`; }
function configured() { return process.env.GEORGIE_SIERRA_CLOSER_ENABLED!=="false"&&sierraWorkforceConfigured()&&neoMailConfigured(); }
function summaryCanHaveOffer(summary) { const status=statusOf(summary); if([...TERMINAL].some(value=>status.includes(value)))return false; return Number(summary?.available_offers||0)>0||Number(summary?.response_count||0)>0||/offer_received|offers_received|closing_conditions/i.test(status)||/offers_received|closing_conditions/i.test(String(summary?.referral_status||"")); }

export function evaluateClosingOutreachCandidate({ deal = {}, offers = [], auditEvents = [] } = {}) {
  const reference=referenceOf(deal),clientEmail=clientEmailOf(deal),status=statusOf(deal);
  if(!reference)return{eligible:false,reason:"DEAL_IDENTITY_MISSING"};
  if(!clientEmail||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail))return{eligible:false,reason:"CLIENT_EMAIL_MISSING",reference};
  if([...TERMINAL].some(value=>status.includes(value)))return{eligible:false,reason:"DEAL_TERMINAL",reference};
  const verifiedOffers=rows(offers).filter(isVerifiedOffer);if(!verifiedOffers.length)return{eligible:false,reason:"VERIFIED_OFFER_EVIDENCE_MISSING",reference};
  const snapshot=offerSnapshot(verifiedOffers),idempotencyKey=`sierra-closing-outreach:v1:${reference}:${snapshot}`;
  if(alreadyRecorded(auditEvents,idempotencyKey))return{eligible:false,reason:"OUTREACH_ALREADY_RECORDED",reference,idempotencyKey,snapshot};
  return{eligible:true,reference,clientEmail,verifiedOffers,snapshot,idempotencyKey};
}

export async function executeClosingOutreachCandidate({ userId=USER_ID,deal,offers,auditEvents,send=sendMessage,record=recordOutboundCorrespondence,selectMailbox=selectGeorgieCorrespondenceMailbox }={}) {
  const candidate=evaluateClosingOutreachCandidate({deal,offers,auditEvents});if(!candidate.eligible)return candidate;
  const mailbox=selectMailbox();if(!mailbox?.id)throw new Error("SIERRA_CLOSER_MAILBOX_NOT_CONFIGURED");
  const subject=`${businessNameOf(deal)} — financing update ready for review`,text=messageFor(deal);
  const receipt=await send(mailbox.id,{to:candidate.clientEmail,subject,text,idempotencyKey:candidate.idempotencyKey,correlationId:candidate.idempotencyKey,dealId:candidate.reference,audience:"client",rationale:"Immediately open a non-binding closing conversation after a verified offer reaches the Sierra file.",evidenceState:{claims:[{type:"lender_position",status:"verified"}],evidenceIds:candidate.verifiedOffers.flatMap(evidenceRefsOf)},escalation:{required:false,approved:false}});
  if(!receipt?.messageId||!Array.isArray(receipt.accepted)||receipt.accepted.length===0||(receipt.rejected||[]).length>0)throw new Error("SIERRA_CLOSER_PROVIDER_RECEIPT_INCOMPLETE");
  const crm=await record(userId,{reference:candidate.reference,receipt,message:{to:candidate.clientEmail,subject,text},eventType:"georgie_verified_offer_closing_outreach"});if(crm?.verification?.ok!==true)throw new Error("SIERRA_CLOSER_CRM_READBACK_INCOMPLETE");
  return{...candidate,status:receipt.deduplicated===true?"deduplicated_verified":"sent_verified",contract:SIERRA_CLOSING_OUTREACH_CONTRACT,providerMessageId:receipt.messageId,crmReadBack:true,humanAccessDisclosure:true};
}

export async function runSierraClosingOutreachCycle({ userId=USER_ID,portfolio=getSierraPortfolio,deal=getSierraDeal,offers=getSierraOffers,audit=getSierraAuditEvents,execute=executeClosingOutreachCandidate }={}) {
  const startedAt=new Date().toISOString(),portfolioResult=await portfolio(userId,{limit:100});
  const portfolioRows=rows(portfolioResult),candidates=portfolioRows.filter(summaryCanHaveOffer).slice(0,MAX_INSPECT_PER_CYCLE),results=[];
  for(const summary of candidates){
    if(results.filter(item=>item.status==="sent_verified").length>=MAX_PER_CYCLE)break;
    const reference=referenceOf(summary);if(!reference){results.push({eligible:false,reason:"DEAL_IDENTITY_MISSING"});continue;}
    try{
      const [fullDeal,dealOffers]=await Promise.all([deal(userId,reference),offers(userId,reference)]);
      if(!rows(dealOffers).some(isVerifiedOffer)){results.push({eligible:false,reason:"VERIFIED_OFFER_EVIDENCE_MISSING",reference});continue;}
      const auditEvents=await audit(userId,{reference,limit:200});
      results.push(await execute({userId,deal:{...summary,...(fullDeal?.deal||fullDeal||{})},offers:dealOffers,auditEvents}));
    }catch(error){results.push({reference,status:"failed",error:clean(error?.message||error,1000)});}
  }
  return{contract:SIERRA_CLOSING_OUTREACH_CONTRACT,startedAt,completedAt:new Date().toISOString(),portfolioSize:portfolioRows.length,inspected:candidates.length,sent:results.filter(item=>item.status==="sent_verified").length,results};
}

export function startSierraClosingOutreachWorker(){
  if(timer||!configured()){if(!configured())console.warn("Sierra closing outreach worker not started: runtime configuration missing or explicitly disabled");return timer;}
  const schedule=(delay=POLL_MS)=>{timer=setTimeout(async()=>{if(running)return schedule();const permit=specialistExecutionPermit("sierra-closing-outreach");if(!permit.allowed){console.warn("SIERRA_CLOSING_OUTREACH_CORE_PRESSURE",JSON.stringify({reason:permit.reason,retryAfterMs:permit.retryAfterMs}));return schedule(permit.retryAfterMs)}running=true;try{const result=await runSierraClosingOutreachCycle();if(result.sent)console.log("SIERRA_CLOSING_OUTREACH",JSON.stringify({sent:result.sent,inspected:result.inspected,portfolioSize:result.portfolioSize,completedAt:result.completedAt}));}catch(error){console.error("SIERRA_CLOSING_OUTREACH_CYCLE_FAILED",clean(error?.stack||error,1200));}finally{running=false;schedule();}},delay);timer.unref?.();};
  schedule(1_000);console.log(`Sierra verified-offer closing outreach worker online (${POLL_MS}ms) ${SIERRA_CLOSING_OUTREACH_CONTRACT}`);return timer;
}
