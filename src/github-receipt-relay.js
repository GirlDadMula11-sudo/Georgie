import crypto from "node:crypto";
import express from "express";
import { readCloudState, writeCloudState } from "./cloud-state.js";
import { controlPlaneSnapshot, recordCallbackDelivery } from "./coordination-control-plane.js";

const REPOSITORY="GirlDadMula11-sudo/Georgie";
const OWNER="GirlDadMula11-sudo";
const WORKFLOW_PATH=".github/workflows/georgie-receipt-relay.yml";
const CONTROL_BRANCH="georgie-control";
const ISSUER="https://token.actions.githubusercontent.com";
const JWKS_URL=`${ISSUER}/.well-known/jwks`;
const AUDIENCE_PREFIX="georgie-github-receipt-relay:";
const NS="github_receipt_relay_oidc_v1";
const CHALLENGE_TTL_MS=2*60_000;
const JWT_MAX_AGE_MS=5*60_000;
const JWKS_TTL_MS=10*60_000;
const stateLocks=new Map();
let jwksCache={at:0,keys:[]};
const now=()=>new Date().toISOString();
const clean=(value,max=1000)=>String(value??"").trim().slice(0,max);
const digest=value=>crypto.createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
const base64url=value=>Buffer.from(String(value).replace(/-/g,"+").replace(/_/g,"/"),"base64");

function defaultState(){return{version:1,challenges:[],events:[],updatedAt:null};}
async function serialized(userId,work){const key=String(userId||"primary"),prior=stateLocks.get(key)||Promise.resolve();const run=prior.catch(()=>{}).then(work);stateLocks.set(key,run.catch(()=>{}));return run;}
async function load(userId="primary"){const state=await readCloudState(userId,NS,defaultState());return{...defaultState(),...(state||{}),challenges:Array.isArray(state?.challenges)?state.challenges:[],events:Array.isArray(state?.events)?state.events:[]};}
async function save(userId,state){state.updatedAt=now();state.challenges=state.challenges.filter(row=>Date.parse(row.expiresAt||0)>Date.now()-60_000).slice(-100);state.events=state.events.slice(-500);await writeCloudState(userId,NS,state);return state;}

function secretShaped(value=""){
  const text=String(value||"");
  return /(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bsbp_[A-Za-z0-9_-]{20,}|\bBearer\s+[A-Za-z0-9._-]{16,}|(?:password|secret|token|private[_ -]?key)\s*[:=]\s*[^\s]{12,})/i.test(text);
}
function assertSecretSafe(values=[]){for(const value of values){if(secretShaped(value))throw new Error("SECRET_SHAPED_RECEIPT_FIELD_REJECTED");}}
function markerFor(commandId,correlationId){return `<!-- georgie-receipt:${clean(commandId||correlationId||"unknown",160).replace(/[^a-zA-Z0-9._:-]/g,"")} -->`;}
function receiptData(callback){
  const metadata=callback?.metadata||{},commandId=clean(metadata.commandId,220),correlationId=clean(metadata.correlationId||metadata.commandId,220),issueNumber=Number(metadata.issueNumber),repository=clean(metadata.repository,200),status=clean(callback?.status||"updated",80),terminal=Boolean(metadata.terminal),evidenceRefs=(Array.isArray(callback?.evidenceRefs)?callback.evidenceRefs:[]).map(value=>clean(value,300)).filter(Boolean).slice(0,50),createdAt=clean(callback?.createdAt||callback?.updatedAt||now(),80),outboxId=clean(callback?.id,160);
  if(repository!==REPOSITORY||!Number.isInteger(issueNumber)||issueNumber<1||!commandId||!outboxId)throw new Error("RELAY_CALLBACK_ROUTING_INVALID");
  assertSecretSafe([commandId,correlationId,status,createdAt,...evidenceRefs]);
  const marker=markerFor(commandId,correlationId);
  const canonical={outboxId,commandId,correlationId,repository,issueNumber,status,terminal,evidenceRefs,marker,createdAt};
  const receiptHash=digest(canonical);
  const lines=["### Georgie AI-control receipt",`Command: \`${commandId}\``,`Correlation: \`${correlationId}\``,`Status: **${status}**`,`Terminal: **${terminal?"yes":"no"}**`,"","Durable Georgie receipt delivered through the GitHub OIDC recovery relay after direct issue-comment transport was unavailable.",evidenceRefs.length?`\nEvidence: ${evidenceRefs.map(value=>`\`${value}\``).join(", ")}`:"","",marker,`<!-- georgie-receipt-hash:${receiptHash} -->`].filter(Boolean);
  return{...canonical,receiptHash,body:lines.join("\n")};
}

export function validateGithubOidcClaims(claims={},audience,{nowMs=Date.now()}={}){
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
  const exp=Number(claims.exp||0)*1000,nbf=Number(claims.nbf||claims.iat||0)*1000,iat=Number(claims.iat||0)*1000;
  if(!exp||exp<nowMs-30_000)throw new Error("OIDC_EXPIRED");
  if(nbf&&nbf>nowMs+30_000)throw new Error("OIDC_NOT_YET_VALID");
  if(!iat||iat<nowMs-JWT_MAX_AGE_MS||iat>nowMs+30_000)throw new Error("OIDC_TOKEN_AGE_REJECTED");
  return true;
}

async function fetchJwks(){if(jwksCache.keys.length&&Date.now()-jwksCache.at<JWKS_TTL_MS)return jwksCache.keys;const response=await fetch(JWKS_URL,{headers:{accept:"application/json"},signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error(`OIDC_JWKS_UNAVAILABLE_${response.status}`);const data=await response.json();const keys=Array.isArray(data?.keys)?data.keys:[];if(!keys.length)throw new Error("OIDC_JWKS_EMPTY");jwksCache={at:Date.now(),keys};return keys;}
function parseJwt(token){const parts=String(token||"").split(".");if(parts.length!==3)throw new Error("OIDC_TOKEN_MALFORMED");let header,claims;try{header=JSON.parse(base64url(parts[0]).toString("utf8"));claims=JSON.parse(base64url(parts[1]).toString("utf8"));}catch{throw new Error("OIDC_TOKEN_MALFORMED");}return{parts,header,claims};}
async function verifyJwt(token,audience){const parsed=parseJwt(token);if(parsed.header?.alg!=="RS256"||!parsed.header?.kid)throw new Error("OIDC_HEADER_REJECTED");const keys=await fetchJwks(),jwk=keys.find(key=>key.kid===parsed.header.kid&&key.kty==="RSA");if(!jwk)throw new Error("OIDC_SIGNING_KEY_NOT_FOUND");const key=crypto.createPublicKey({key:jwk,format:"jwk"});const signed=Buffer.from(`${parsed.parts[0]}.${parsed.parts[1]}`),signature=base64url(parsed.parts[2]);if(!crypto.verify("RSA-SHA256",signed,key,signature))throw new Error("OIDC_SIGNATURE_REJECTED");validateGithubOidcClaims(parsed.claims,audience);return parsed.claims;}

async function issueChallenge(userId="primary"){
  return serialized(userId,async()=>{const state=await load(userId),nonce=crypto.randomBytes(24).toString("base64url"),nonceHash=digest(nonce),createdAt=now(),expiresAt=new Date(Date.now()+CHALLENGE_TTL_MS).toISOString();state.challenges.push({nonceHash,createdAt,expiresAt,usedAt:null});await save(userId,state);return{nonce,expiresAt,audience:`${AUDIENCE_PREFIX}${nonce}`};});
}
async function consumeChallenge(userId,nonce){return serialized(userId,async()=>{const state=await load(userId),hash=digest(nonce),row=state.challenges.find(item=>item.nonceHash===hash);if(!row||row.usedAt||Date.parse(row.expiresAt||0)<=Date.now())throw new Error("OIDC_CHALLENGE_REJECTED");row.usedAt=now();await save(userId,state);return true;});}
async function authenticate(req,userId="primary"){
  const token=clean(String(req.headers.authorization||"").replace(/^Bearer\s+/i,""),12000);if(!token)throw new Error("OIDC_AUTH_REQUIRED");const {claims}=parseJwt(token),aud=Array.isArray(claims.aud)?claims.aud.find(value=>String(value).startsWith(AUDIENCE_PREFIX)):claims.aud;if(!String(aud||"").startsWith(AUDIENCE_PREFIX))throw new Error("OIDC_AUDIENCE_REJECTED");const nonce=String(aud).slice(AUDIENCE_PREFIX.length);if(!nonce)throw new Error("OIDC_CHALLENGE_REJECTED");await verifyJwt(token,String(aud));await consumeChallenge(userId,nonce);return claims;
}

function permissionBlocked(callback){const message=String(callback?.lastDeliveryError||"");const errors=Array.isArray(callback?.deliveryErrors)?callback.deliveryErrors.map(row=>row?.message||"").join(" "):"";return /Resource not accessible by personal access token|permission_denied|GitHub request failed \(403\)/i.test(`${message} ${errors}`);}
async function nextRelayCallback(userId="primary"){
  const snapshot=await controlPlaneSnapshot(userId);return(snapshot.callbacks||[]).filter(callback=>callback?.deliveryMode==="github_ai_control"&&!callback?.delivered&&permissionBlocked(callback)&&callback?.metadata?.repository===REPOSITORY&&callback?.metadata?.commandId).sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")))[0]||null;
}
async function recordRelayEvent(userId,event){return serialized(userId,async()=>{const state=await load(userId);state.events.push({id:crypto.randomUUID(),at:now(),...event});await save(userId,state);});}

export function createGithubReceiptRelayRouter(){
  const router=express.Router(),userId=String(process.env.GEORGIE_EXECUTIVE_USER_ID||process.env.GEORGIE_PRIMARY_USER_ID||"primary");
  router.get("/challenge",async(_req,res)=>{try{res.set("Cache-Control","no-store").json({ok:true,...await issueChallenge(userId)});}catch(error){res.status(503).json({ok:false,error:error instanceof Error?error.message:"Relay challenge unavailable"});}});
  router.get("/pending",async(req,res)=>{try{await authenticate(req,userId);const callback=await nextRelayCallback(userId);if(!callback)return res.json({ok:true,hasPending:false});const receipt=receiptData(callback);await recordRelayEvent(userId,{type:"relay_pending",outboxId:receipt.outboxId,commandId:receipt.commandId,receiptHash:receipt.receiptHash});res.set("Cache-Control","no-store").json({ok:true,hasPending:true,receipt});}catch(error){res.status(401).json({ok:false,error:error instanceof Error?error.message:"Relay authentication failed"});}});
  router.post("/ack",async(req,res)=>{try{await authenticate(req,userId);const outboxId=clean(req.body?.outboxId,160),receiptHash=clean(req.body?.receiptHash,128),commentId=Number(req.body?.commentId),url=clean(req.body?.url,1000),readBackConfirmed=req.body?.readBackConfirmed===true,deduplicated=req.body?.deduplicated===true;if(!outboxId||!receiptHash||!readBackConfirmed||!Number.isFinite(commentId))return res.status(400).json({ok:false,error:"Relay acknowledgement is incomplete"});const snapshot=await controlPlaneSnapshot(userId),callback=(snapshot.callbacks||[]).find(row=>row.id===outboxId);if(!callback)return res.status(404).json({ok:false,error:"Relay outbox item not found"});if(callback.delivered)return res.json({ok:true,deduplicated:true,delivered:true});const expected=receiptData(callback);if(expected.receiptHash!==receiptHash)throw new Error("RELAY_RECEIPT_HASH_MISMATCH");const updated=await recordCallbackDelivery(userId,{callbackId:outboxId,delivered:true,receipt:{ok:true,readBackConfirmed:true,commentId,url,attempts:1,writeAttempts:deduplicated?0:1,deduplicated,errors:[]}});await recordRelayEvent(userId,{type:"relay_delivered",outboxId,commandId:expected.commandId,receiptHash,commentId,deduplicated});res.json({ok:true,delivered:Boolean(updated?.delivered),outboxId,commandId:expected.commandId});}catch(error){res.status(401).json({ok:false,error:error instanceof Error?error.message:"Relay acknowledgement rejected"});}});
  return router;
}

export const githubReceiptRelayInternals={receiptData,secretShaped,markerFor,permissionBlocked};
