import crypto from "node:crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";

const NS="seo_content_pipeline_v1";
const STAGES=["research","factual_verification","sierra_insight","brief","draft","claims_compliance","internal_linking_schema","staging_preview","qa","publish_ready","published"];
const now=()=>new Date().toISOString();
const clean=(v,max=12000)=>String(v??"").trim().slice(0,max);
const redact=(value,depth=0)=>{if(depth>4)return"[bounded]";if(Array.isArray(value))return value.slice(0,50).map(v=>redact(v,depth+1));if(value&&typeof value==="object"){const o={};for(const[k,v]of Object.entries(value).slice(0,100))o[k]=/(password|secret|token|cookie|authorization|credential|ssn|ein)/i.test(k)?"[redacted]":redact(v,depth+1);return o;}return typeof value==="string"?value.slice(0,12000):value;};
async function store(userId){return readCloudState(String(userId||"primary"),NS,{version:1,pipelines:[]});}
async function save(userId,s){const next={version:1,pipelines:(s.pipelines||[]).slice(-500),updatedAt:now()};await writeCloudState(String(userId||"primary"),NS,next);return next;}
function stageIndex(stage){const i=STAGES.indexOf(stage);if(i<0)throw new Error("Invalid SEO content stage");return i;}

export async function createSeoContentPipeline(userId,input={}){
  const key=clean(input.stableKey||input.contentKey,200);if(!key)throw new Error("stableKey/contentKey required");const s=await store(userId);let p=(s.pipelines||[]).find(x=>x.stableKey===key&&x.status!=="cancelled");if(p)return{status:"deduplicated",pipeline:p};
  p={id:crypto.randomUUID(),stableKey:key,pageUrl:clean(input.pageUrl,1200)||null,topic:clean(input.topic,500),targetIntent:clean(input.targetIntent,500),stage:"research",status:"active",artifacts:{research:null,facts:null,sierraInsight:null,brief:null,draft:null,claims:null,linksSchema:null,preview:null,qa:null,publish:null},evidenceRefs:[],createdAt:now(),updatedAt:now()};s.pipelines=[...(s.pipelines||[]),p];await save(userId,s);return{status:"created",pipeline:p};
}

function validateCheckpoint(stage,payload={}){
  if(stage==="research"&&!Array.isArray(payload.sources))throw new Error("Research stage requires sources[]");
  if(stage==="factual_verification"&&(!Array.isArray(payload.verifiedClaims)||payload.verifiedClaims.length===0))throw new Error("Factual verification requires verifiedClaims[]");
  if(stage==="brief"&&!clean(payload.primaryQuery||payload.title,500))throw new Error("Brief requires primaryQuery or title");
  if(stage==="draft"&&clean(payload.content,50000).length<200)throw new Error("Draft content is too short");
  if(stage==="claims_compliance"&&payload.passed!==true)throw new Error("Claims/compliance stage must explicitly pass");
  if(stage==="internal_linking_schema"&&(!Array.isArray(payload.internalLinks)||!payload.schema))throw new Error("Internal linking/schema stage requires internalLinks[] and schema");
  if(stage==="staging_preview"&&!clean(payload.previewUrl,1200))throw new Error("Staging preview URL required");
  if(stage==="qa"&&payload.passed!==true)throw new Error("QA must explicitly pass");
  if(stage==="publish_ready"&&payload.approvalRequired!==true)throw new Error("Publish-ready checkpoint must preserve production approval requirement");
}

export async function checkpointSeoContentPipeline(userId,input={}){
  const s=await store(userId),p=(s.pipelines||[]).find(x=>x.id===input.pipelineId||x.stableKey===input.stableKey);if(!p)throw new Error("SEO content pipeline not found");const stage=clean(input.stage,80);const current=stageIndex(p.stage),requested=stageIndex(stage);if(requested>current+1)throw new Error("SEO content stages cannot be skipped");if(requested<current)throw new Error("SEO content stage cannot move backwards; create an explicit revision instead");validateCheckpoint(stage,input.payload||{});
  const map={research:"research",factual_verification:"facts",sierra_insight:"sierraInsight",brief:"brief",draft:"draft",claims_compliance:"claims",internal_linking_schema:"linksSchema",staging_preview:"preview",qa:"qa",publish_ready:"publish",published:"publish"};p.artifacts[map[stage]]=redact(input.payload||{});p.evidenceRefs=[...new Set([...(p.evidenceRefs||[]),...(input.evidenceRefs||[]).map(v=>clean(v,300))])].slice(-100);p.stage=stage;p.status=stage==="published"?"published":"active";p.updatedAt=now();await save(userId,s);return p;
}

export async function seoContentPipelineStatus(userId,input={}){const s=await store(userId);const rows=(s.pipelines||[]).filter(p=>!input.status||input.status==="all"||p.status===input.status).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,Math.max(1,Math.min(Number(input.limit)||50,200)));return{contract:"georgie.seo-content-pipeline.v1",stages:STAGES,productionPublishApprovalRequired:true,pipelines:rows};}

export function seoContentPipelineContract(){return{contract:"georgie.seo-content-pipeline.v1",stages:STAGES,productionPublishApprovalRequired:true,noAutoPublishWithoutApprovedGitHubOrCmsPromotion:true,requiredFlow:"research → factual verification → Sierra insight → brief → draft → claims/compliance → internal links/schema → staging preview → QA → publish approval → publish"};}
