import crypto from "node:crypto";
import express from "express";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { parseAIControlEnvelopes } from "./ai-control-envelope.js";
import { enqueueHandoff } from "./shared-mission.js";
import { createGovernedConnector } from "./governed-connector.js";
import { recordCallback, recordCallbackDelivery } from "./coordination-control-plane.js";
import { postAIControlReceipt } from "./integrations/github-ai-control.js";

const REPOSITORY="GirlDadMula11-sudo/Georgie";
const OWNER="GirlDadMula11-sudo";
const WORKFLOW_PATH=".github/workflows/georgie-receipt-relay.yml";
const CONTROL_BRANCH="georgie-control";
const ISSUER="https://token.actions.githubusercontent.com";
const JWKS_URL=`${ISSUER}/.well-known/jwks`;
const AUDIENCE_PREFIX="georgie-github-control-inbound:";
const NS="github_control_inbound_oidc_v1";
const CHALLENGE_TTL_MS=2*60_000;
const JWT_MAX_AGE_MS=5*60_000;
const JWKS_TTL_MS=10*60_000;
const locks=new Map();
let jwksCache={at:0,keys:[]};
const now=()=>new Date().toISOString();
const clean=(value,max=4000)=>String(value??"").trim().slice(0,max);
const b64=value=>Buffer.from(String(value).replace(/-/g,"+").replace(/_/g,"/"),"base64");
function challengeKey(){const source=clean(process.env.GEORGIE_GITHUB_CONTROL_CHALLENGE_SECRET||process.env.GEORGIE_MAC_AGENT_TOKEN||process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY,12000);if(source.length<32)throw new Error("OIDC_CHALLENGE_SECRET_UNAVAILABLE");return crypto.createHash("sha256").update("georgie-github-control-challenge-v3\0").update(source).digest();}
function signChallenge(payload){return crypto.createHmac("sha256",challengeKey()).update(payload).digest("base64url");}
export function validateSignedGithubControlChallenge(nonce,{nowMs=Date.now()}={}){const parts=String(nonce||"").split(".");if(parts.length!==2)throw new Error("OIDC_CHALLENGE_REJECTED");const [payload,signature]=parts,expected=signChallenge(payload),provided=Buffer.from(signature),wanted=Buffer.from(expected);if(provided.length!==wanted.length||!crypto.timingSafeEqual(provided,wanted))throw new Error("OIDC_CHALLENGE_REJECTED");let decoded;try{decoded=JSON.parse(b64(payload).toString("utf8"));}catch{throw new Error("OIDC_CHALLENGE_REJECTED");}const issuedAt=Number(decoded?.iat||0),expiresAt=Number(decoded?.exp||0);if(!issuedAt||!expiresAt||issuedAt>nowMs+30_000||expiresAt<=nowMs||expiresAt-issuedAt!==CHALLENGE_TTL_MS)throw new Error("OIDC_CHALLENGE_REJECTED");return decoded;}
function defaultState(){return{version:2,challenges:[],events:[],bindings:[],updatedAt:null};}
async function serialized(userId,work){const key=String(userId||"primary"),prior=locks.get(key)||Promise.resolve();const run=prior.catch(()=>{}).then(work);locks.set(key,run.catch(()=>{}));return run;}
async function load(userId){const state=await readCloudState(userId,NS,defaultState());return{...defaultState(),...(state||{}),challenges:Array.isArray(state?.challenges)?state.challenges:[],events:Array.isArray(state?.events)?state.events:[],bindings:Array.isArray(state?.bindings)?state.bindings:[]};}
async function save(userId,state){state.updatedAt=now();state.challenges=state.challenges.filter(x=>Date.parse(x.expiresAt||0)>Date.now()-60_000).slice(-100);state.events=state.events.slice(-500);state.bindings=state.bindings.slice(-1000);await writeCloudState(userId,NS,state);return state;}
async function issueChallenge(){const issuedAt=Date.now(),expiresAt=issuedAt+CHALLENGE_TTL_MS,payload=Buffer.from(JSON.stringify({v:3,iat:issuedAt,exp:expiresAt,r:crypto.randomBytes(24).toString("base64url")})).toString("base64url"),nonce=`${payload}.${signChallenge(payload)}`;return{nonce,expiresAt:new Date(expiresAt).toISOString(),audience:`${AUDIENCE_PREFIX}${nonce}`,persistence:"stateless-hmac-v3"};}
async function consumeChallenge(_userId,nonce){validateSignedGithubControlChallenge(nonce);}
const TERMINAL_STATUSES=new Set(["completed","blocked","failed"]);
async function bindConnectorCommand(userId,binding){return serialized(userId,async()=>{const state=await load(userId),key=clean(binding.connectorCommandId,220),existing=state.bindings.find(row=>row.connectorCommandId===key),value={connectorCommandId:key,repository:REPOSITORY,issueNumber:Number(binding.issueNumber),commandId:clean(binding.commandId,220),correlationId:clean(binding.correlationId||binding.commandId,220),objectiveId:clean(binding.objectiveId,80),createdAt:existing?.createdAt||now(),updatedAt:now()};if(existing)Object.assign(existing,value);else state.bindings.push(value);await save(userId,state);return value;});}
async function connectorBinding(userId,connectorCommandId){const state=await load(userId);return state.bindings.find(row=>row.connectorCommandId===clean(connectorCommandId,220))||null;}
function terminalEvidence(event={}){const receipt=event.receipt||{},payload=receipt.payload||{},refs=[receipt.receiptId?`connector-receipt:${clean(receipt.receiptId,180)}`:null,event.commandId?`connector-command:${clean(event.commandId,180)}`:null,payload.responseHash?`response-sha256:${clean(payload.responseHash,128)}`:null];return refs.filter(Boolean);}
async function publishConnectorTerminalStatus(userId,event={}){
  if(!TERMINAL_STATUSES.has(clean(event.status,80)))return null;
  const binding=await connectorBinding(userId,event.commandId);if(!binding)return null;
  const evidenceRefs=terminalEvidence(event),summary=`Governed connector command ${binding.connectorCommandId} reached terminal ${clean(event.status,80)} with a durable internal receipt.`;
  const callback=await recordCallback(userId,{objectiveId:binding.objectiveId||clean(event.objectiveId,80),from:"georgie",to:"chatgpt",type:"ai_control_receipt",status:clean(event.status,80),summary,evidenceRefs,deliveryMode:"github_ai_control",idempotencyKey:`ai-control-receipt:${binding.commandId}`,metadata:{repository:binding.repository,issueNumber:binding.issueNumber,commandId:binding.commandId,correlationId:binding.correlationId,connectorCommandId:binding.connectorCommandId,terminal:true}});
  const delivery=await postAIControlReceipt(binding.repository,binding.issueNumber,{commandId:binding.commandId,correlationId:binding.correlationId,status:event.status,summary,evidenceRefs,terminal:true});
  return recordCallbackDelivery(userId,{callbackId:callback.id,delivered:delivery.ok===true&&delivery.readBackConfirmed===true,error:delivery.error?.message||null,receipt:delivery});
}
async function reconcileTerminalStatus(userId,binding,command){if(!command||!TERMINAL_STATUSES.has(clean(command.status,80)))return null;const receipts=Array.isArray(command.receipts)?command.receipts:[],receipt=[...receipts].reverse().find(row=>clean(row.status,80)===clean(command.status,80))||receipts.at(-1)||null;return publishConnectorTerminalStatus(userId,{commandId:binding.connectorCommandId,objectiveId:command.objectiveId,status:command.status,receipt});}
function parseJwt(token){const parts=String(token||"").split(".");if(parts.length!==3)throw new Error("OIDC_TOKEN_MALFORMED");try{return{parts,header:JSON.parse(b64(parts[0]).toString("utf8")),claims:JSON.parse(b64(parts[1]).toString("utf8"))};}catch{throw new Error("OIDC_TOKEN_MALFORMED");}}
async function fetchJwks(){if(jwksCache.keys.length&&Date.now()-jwksCache.at<JWKS_TTL_MS)return jwksCache.keys;const response=await fetch(JWKS_URL,{headers:{accept:"application/json"},signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error(`OIDC_JWKS_UNAVAILABLE_${response.status}`);const data=await response.json(),keys=Array.isArray(data?.keys)?data.keys:[];if(!keys.length)throw new Error("OIDC_JWKS_EMPTY");jwksCache={at:Date.now(),keys};return keys;}
export function validateGithubControlOidcClaims(claims={},audience,{nowMs=Date.now()}={}){
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==ISSUER)throw new Error("OIDC_ISSUER_REJECTED");
  if(!aud.includes(audience))throw new Error("OIDC_AUDIENCE_REJECTED");
  if(claims.repository!==REPOSITORY||claims.repository_owner!==OWNER)throw new Error("OIDC_REPOSITORY_REJECTED");
  const event=String(claims.event_name||"");
  if(event==="push"){
    const ref=`refs/heads/${CONTROL_BRANCH}`;
    if(claims.ref!==ref)throw new Error("OIDC_REF_REJECTED");
    if(claims.workflow_ref!==`${REPOSITORY}/${WORKFLOW_PATH}@${ref}`)throw new Error("OIDC_WORKFLOW_REJECTED");
  } else if(event==="schedule"||event==="workflow_dispatch"){
    if(claims.ref!=="refs/heads/main")throw new Error("OIDC_REF_REJECTED");
    if(claims.workflow_ref!==`${REPOSITORY}/${WORKFLOW_PATH}@refs/heads/main`)throw new Error("OIDC_WORKFLOW_REJECTED");
  } else {
    throw new Error("OIDC_EVENT_REJECTED");
  }
  const exp=Number(claims.exp||0)*1000,iat=Number(claims.iat||0)*1000;
  if(!exp||exp<nowMs-30_000)throw new Error("OIDC_EXPIRED");
  if(!iat||iat<nowMs-JWT_MAX_AGE_MS||iat>nowMs+30_000)throw new Error("OIDC_TOKEN_AGE_REJECTED");
  return true;
}
async function authenticate(req,userId){const token=clean(String(req.headers.authorization||"").replace(/^Bearer\s+/i,""),12000);if(!token)throw new Error("OIDC_AUTH_REQUIRED");const parsed=parseJwt(token),aud=Array.isArray(parsed.claims.aud)?parsed.claims.aud.find(v=>String(v).startsWith(AUDIENCE_PREFIX)):parsed.claims.aud;if(!String(aud||"").startsWith(AUDIENCE_PREFIX))throw new Error("OIDC_AUDIENCE_REJECTED");const nonce=String(aud).slice(AUDIENCE_PREFIX.length),keys=await fetchJwks(),jwk=keys.find(k=>k.kid===parsed.header?.kid&&k.kty==="RSA");if(parsed.header?.alg!=="RS256"||!jwk)throw new Error("OIDC_HEADER_REJECTED");const key=crypto.createPublicKey({key:jwk,format:"jwk"}),signed=Buffer.from(`${parsed.parts[0]}.${parsed.parts[1]}`),signature=b64(parsed.parts[2]);if(!crypto.verify("RSA-SHA256",signed,key,signature))throw new Error("OIDC_SIGNATURE_REJECTED");validateGithubControlOidcClaims(parsed.claims,String(aud));await consumeChallenge(userId,nonce);return parsed.claims;}
export async function ingestGithubControlComment(userId,{repository,issueNumber,commentId,author,body}={}, { connector = null } = {}){if(clean(repository,200)!==REPOSITORY)throw new Error("CONTROL_REPOSITORY_REJECTED");if(clean(author,100)!==OWNER)throw new Error("CONTROL_AUTHOR_REJECTED");if(!Number.isInteger(Number(issueNumber))||Number(issueNumber)<1||!Number.isInteger(Number(commentId)))throw new Error("CONTROL_SOURCE_ID_REJECTED");const parsed=parseAIControlEnvelopes(clean(body,100000)),accepted=[],rejected=[];for(const item of parsed){if(!item.ok){rejected.push(item.error);continue;}const e=item.envelope;if(connector){const args=e.args&&typeof e.args==="object"?e.args:{};const admitted=await connector.submit(userId,{source:"github_ai_control",command:clean(args.command||`Execute governed ${e.tool}`,6000),idempotencyKey:e.idempotencyKey,objectiveId:e.objectiveId,metadata:{...args,capability:e.tool,target_device:clean(args.target_device||args.targetDevice,160),operation:clean(args.operation,160),authority:e.requestedAuthority,prohibited_routes:Array.isArray(args.prohibited_routes)?args.prohibited_routes:[]}});const binding=await bindConnectorCommand(userId,{connectorCommandId:admitted.commandId,repository,issueNumber,commandId:e.commandId,correlationId:e.correlationId,objectiveId:e.objectiveId});if(TERMINAL_STATUSES.has(clean(admitted.status,80))){const current=await connector.status(userId,admitted.commandId);await reconcileTerminalStatus(userId,binding,current).catch(()=>null);}accepted.push({commandId:e.commandId,connectorCommandId:admitted.commandId,objectiveId:e.objectiveId,idempotencyKey:e.idempotencyKey,status:admitted.status,duplicate:admitted.duplicate===true});continue;}const queued=await enqueueHandoff(userId,{source:"authorized_assistant_control_command",priority:e.slaClass==="P0"?100:e.slaClass==="P1"?90:e.slaClass==="P2"?75:55,objective:`AI control: ${e.tool}`,type:"engineering",requestedAuthority:e.requestedAuthority,dependsOn:e.dependsOn,acceptanceCriteria:e.acceptanceCriteria,scope:{repository:REPOSITORY,issueNumber:Number(issueNumber),commentId:Number(commentId),controlCommand:e,mutationScope:e.mutationScope},evidence:{author,integrityHash:e.integrityHash,transport:"github_oidc_inbound"},dedupeKey:`ai-control:${e.idempotencyKey}`});accepted.push({commandId:e.commandId,objectiveId:e.objectiveId,idempotencyKey:e.idempotencyKey,status:queued.status,handoffId:queued.item?.id||null});}return{ok:true,accepted,rejected};}
export function createGithubControlInboundRouter({ executeCommand } = {}){
  if(typeof executeCommand!=="function")throw new Error("GitHub control inbound requires governed execution");
  const router=express.Router();
  const userId=String(process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary");
  const connector=createGovernedConnector({executeCommand,emitStatus:event=>publishConnectorTerminalStatus(userId,event)});
  router.get("/challenge",async(_req,res)=>{
    try{res.set("Cache-Control","no-store").json({ok:true,...await issueChallenge(userId)});}
    catch(error){res.status(503).json({ok:false,error:error instanceof Error?error.message:"Inbound challenge unavailable"});}
  });
  router.post("/ingest",async(req,res)=>{
    try{
      await authenticate(req,userId);
      const result=await ingestGithubControlComment(userId,req.body||{},{connector});
      res.set("Cache-Control","no-store").json(result);
    }catch(error){
      res.status(401).json({ok:false,error:error instanceof Error?error.message:"Inbound control rejected"});
    }
  });
  router.post("/status",async(req,res)=>{
    try{
      await authenticate(req,userId);
      const commandId=clean(req.body?.commandId,220);
      if(!commandId)return res.status(400).set("Cache-Control","no-store").json({ok:false,error:"Command ID is required"});
      const command=await connector.status(userId,commandId);
      if(command){const binding=await connectorBinding(userId,commandId);if(binding)await reconcileTerminalStatus(userId,binding,command).catch(()=>null);}
      res.status(command?200:404).set("Cache-Control","no-store").json(command?{ok:true,command}:{ok:false,error:"Command not found"});
    }catch(error){
      res.status(401).json({ok:false,error:error instanceof Error?error.message:"Inbound status rejected"});
    }
  });
  return router;
}

export const githubControlInboundInternals={bindConnectorCommand,connectorBinding,publishConnectorTerminalStatus,reconcileTerminalStatus,terminalEvidence};
