import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const DEFAULT_DATA_DIR = process.env.VERCEL ? "/tmp/georgie-data" : "data";
const PREFERRED_DATA_DIR = path.resolve(process.env.GEORGIE_DATA_DIR || DEFAULT_DATA_DIR);
const FALLBACK_DATA_DIR = path.join(os.tmpdir(), "georgie-data");
const EMPTY_STORE = { version: 1, profiles: {}, memories: [], sessions: {} };
const CLOUD_URL = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const CLOUD_KEY = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
const CLOUD_ENABLED = Boolean(CLOUD_URL && CLOUD_KEY);
let writeQueue = Promise.resolve();
let lastCloudError = null;
let activeDataDir = null;
let memoryFallback = structuredClone(EMPTY_STORE);

function now(){return new Date().toISOString();}
function normalizeUserId(value){return String(value||"primary").trim().slice(0,100)||"primary";}
function normalizeStore(parsed){return {...EMPTY_STORE,...(parsed||{}),profiles:parsed?.profiles||{},memories:Array.isArray(parsed?.memories)?parsed.memories:[],sessions:parsed?.sessions||{}};}
function cloudHeaders(){return {"content-type":"application/json","apikey":CLOUD_KEY,"authorization":`Bearer ${CLOUD_KEY}`};}
async function cloudRpc(name,body){const response=await fetch(`${CLOUD_URL}/rest/v1/rpc/${name}`,{method:"POST",headers:cloudHeaders(),body:JSON.stringify(body),signal:AbortSignal.timeout(6000)});if(!response.ok)throw new Error(`Cloud state ${name} failed (${response.status})`);return response.json();}
async function cloudRead(userId){const result=await cloudRpc("georgie_get_state",{p_user_id:normalizeUserId(userId)});lastCloudError=null;return normalizeStore(result);}
async function cloudWrite(userId,store){await cloudRpc("georgie_put_state",{p_user_id:normalizeUserId(userId),p_state:store});lastCloudError=null;}

async function resolveLocalDataDir(){
  if(activeDataDir)return activeDataDir;
  for(const candidate of [PREFERRED_DATA_DIR,FALLBACK_DATA_DIR]){
    try{
      await fs.mkdir(candidate,{recursive:true,mode:0o700});
      const probe=path.join(candidate,`.write-probe-${process.pid}`);
      await fs.writeFile(probe,"ok",{mode:0o600});
      await fs.unlink(probe).catch(()=>{});
      activeDataDir=candidate;
      return candidate;
    }catch(error){
      console.warn(`Georgie memory storage unavailable at ${candidate}:`,error instanceof Error?error.message:error);
    }
  }
  return null;
}

async function localRead(){
  const dir=await resolveLocalDataDir();
  if(!dir)return structuredClone(memoryFallback);
  const file=path.join(dir,"memory.json");
  try{
    const parsed=normalizeStore(JSON.parse(await fs.readFile(file,"utf8")));
    memoryFallback=structuredClone(parsed);
    return parsed;
  }catch(error){
    if(error?.code!=="ENOENT")console.warn("Georgie local memory read failed:",error instanceof Error?error.message:error);
    return structuredClone(memoryFallback);
  }
}

async function localWrite(store){
  const normalized=normalizeStore(store);
  memoryFallback=structuredClone(normalized);
  const dir=await resolveLocalDataDir();
  if(!dir)return;
  const file=path.join(dir,"memory.json");
  try{
    const temp=`${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp,JSON.stringify(normalized,null,2),{mode:0o600});
    await fs.rename(temp,file);
  }catch(error){
    console.warn("Georgie local memory write failed; continuing in memory:",error instanceof Error?error.message:error);
    activeDataDir=null;
  }
}

async function readStore(userId="primary"){if(CLOUD_ENABLED){try{return await cloudRead(userId);}catch(error){lastCloudError=error instanceof Error?error.message:String(error);console.warn("Georgie cloud memory unavailable; using resilient local fallback:",lastCloudError);}}return localRead();}
async function writeStore(userId,store){const task=async()=>{if(CLOUD_ENABLED){try{await cloudWrite(userId,store);return;}catch(error){lastCloudError=error instanceof Error?error.message:String(error);console.warn("Georgie cloud memory write unavailable; persisting fallback copy:",lastCloudError);}}await localWrite(store);};writeQueue=writeQueue.then(task,task);return writeQueue;}
function tokenize(value){return new Set(String(value||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(word=>word.length>2));}
function scoreMemory(memory,queryTokens){const memoryTokens=tokenize(`${memory.text} ${(memory.tags||[]).join(" ")} ${memory.category||""}`);let overlap=0;for(const token of queryTokens)if(memoryTokens.has(token))overlap+=1;const ageDays=Math.max(0,(Date.now()-new Date(memory.updatedAt||memory.createdAt).getTime())/86400000);const recency=1/(1+ageDays/30);const importance=Math.max(0,Math.min(1,Number(memory.importance??0.5)));return overlap*3+importance*2+recency;}
export function getMemoryStorageStatus(){const localMode=activeDataDir===PREFERRED_DATA_DIR?"local_disk":activeDataDir?"runtime_temp":"memory";return {mode:CLOUD_ENABLED?"durable_cloud":localMode,durable:CLOUD_ENABLED||activeDataDir===PREFERRED_DATA_DIR,provider:CLOUD_ENABLED?"supabase":localMode,healthy:CLOUD_ENABLED?!lastCloudError:true,lastError:lastCloudError,path:activeDataDir};}
export async function getProfile(userId="primary"){const id=normalizeUserId(userId);const store=await readStore(id);return store.profiles[id]||{userId:id,createdAt:now(),updatedAt:now(),attributes:{}};}
export async function updateProfile(userId="primary",patch={}){const id=normalizeUserId(userId);const store=await readStore(id);const current=store.profiles[id]||{userId:id,createdAt:now(),attributes:{}};const attributes={...(current.attributes||{}),...((patch&&typeof patch.attributes==="object"&&patch.attributes)||{})};store.profiles[id]={...current,...patch,userId:id,attributes,createdAt:current.createdAt||now(),updatedAt:now()};await writeStore(id,store);return store.profiles[id];}
export async function addMemory({userId="primary",text,category="fact",importance=0.5,tags=[],source="conversation"}){if(!text?.trim())return null;const id=normalizeUserId(userId);const store=await readStore(id);const normalized=text.trim().slice(0,2000);const duplicate=store.memories.find(memory=>memory.userId===id&&memory.text.toLowerCase()===normalized.toLowerCase());if(duplicate){duplicate.updatedAt=now();duplicate.importance=Math.max(duplicate.importance||0,Number(importance)||0);duplicate.tags=[...new Set([...(duplicate.tags||[]),...tags.map(String)])].slice(0,12);await writeStore(id,store);return duplicate;}const memory={id:crypto.randomUUID(),userId:id,text:normalized,category:String(category||"fact").slice(0,50),importance:Math.max(0,Math.min(1,Number(importance)||0.5)),tags:[...new Set(tags.map(String))].slice(0,12),source,createdAt:now(),updatedAt:now()};store.memories.push(memory);if(store.memories.length>5000)store.memories=store.memories.slice(-5000);await writeStore(id,store);return memory;}
export async function searchMemories(userId="primary",query="",limit=8){const id=normalizeUserId(userId);const store=await readStore(id);const queryTokens=tokenize(query);return store.memories.filter(memory=>memory.userId===id).map(memory=>({...memory,_score:scoreMemory(memory,queryTokens)})).sort((a,b)=>b._score-a._score).slice(0,Math.max(1,Math.min(20,Number(limit)||8))).map(({_score,...memory})=>memory);}
export async function listMemories(userId="primary",limit=100){const id=normalizeUserId(userId);const store=await readStore(id);return store.memories.filter(memory=>memory.userId===id).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,Math.max(1,Math.min(500,Number(limit)||100)));}
export async function deleteMemory(userId="primary",memoryId){const id=normalizeUserId(userId);const store=await readStore(id);const before=store.memories.length;store.memories=store.memories.filter(memory=>!(memory.userId===id&&memory.id===memoryId));if(store.memories.length===before)return false;await writeStore(id,store);return true;}
export async function appendSessionTurn({userId="primary",sessionId="default",role,content}){const id=normalizeUserId(userId);const sid=String(sessionId||"default").slice(0,150);const store=await readStore(id);const key=`${id}:${sid}`;const session=store.sessions[key]||{userId:id,sessionId:sid,turns:[],createdAt:now()};session.turns.push({role,content:String(content||"").slice(0,12000),at:now()});session.turns=session.turns.slice(-80);session.updatedAt=now();store.sessions[key]=session;await writeStore(id,store);return session;}
export async function getSessionHistory(userId="primary",sessionId="default",limit=16){const id=normalizeUserId(userId);const sid=String(sessionId||"default").slice(0,150);const store=await readStore(id);const session=store.sessions[`${id}:${sid}`];if(!session)return[];return session.turns.slice(-Math.max(1,Math.min(40,Number(limit)||16))).map(({role,content})=>({role,content}));}
export async function buildMemoryContext(userId="primary",query=""){const[profile,memories]=await Promise.all([getProfile(userId),searchMemories(userId,query,8)]);const profileAttributes=Object.entries(profile.attributes||{}).filter(([,value])=>value!==undefined&&value!==null&&String(value).trim()).map(([key,value])=>`${key}: ${String(value)}`).join("\n");const memoryText=memories.map(memory=>`- [${memory.category}] ${memory.text}`).join("\n");return{profile,memories,prompt:[profileAttributes?`Known user profile:\n${profileAttributes}`:"",memoryText?`Relevant durable memories:\n${memoryText}`:""].filter(Boolean).join("\n\n")};}
