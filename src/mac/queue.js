import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.GEORGIE_DATA_DIR || (process.env.VERCEL ? "/tmp/georgie-data" : "data");
const FILE = path.join(DATA_DIR, "mac-jobs.json");
async function readStore(){await fs.mkdir(DATA_DIR,{recursive:true});try{return JSON.parse(await fs.readFile(FILE,"utf8"));}catch{return{jobs:[]};}}
async function writeStore(store){await fs.mkdir(DATA_DIR,{recursive:true});const tmp=`${FILE}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(tmp,JSON.stringify(store,null,2));await fs.rename(tmp,FILE);}
export async function enqueueMacJob({userId,deviceId,action,args={},risk="low_risk_write",reason=""}){const store=await readStore();const job={id:crypto.randomUUID(),userId,deviceId,action,args,risk,reason,status:"queued",createdAt:new Date().toISOString(),claimedAt:null,completedAt:null,result:null,error:null};store.jobs.push(job);store.jobs=store.jobs.slice(-5000);await writeStore(store);return job;}
export async function claimMacJobs(deviceId,limit=5){const store=await readStore();const jobs=store.jobs.filter(j=>j.deviceId===deviceId&&j.status==="queued").slice(0,limit);const now=new Date().toISOString();for(const job of jobs){job.status="claimed";job.claimedAt=now;}if(jobs.length)await writeStore(store);return jobs;}
export async function completeMacJob(deviceId,jobId,{result=null,error=null}={}){const store=await readStore();const job=store.jobs.find(j=>j.id===jobId&&j.deviceId===deviceId);if(!job)return null;job.status=error?"failed":"completed";job.completedAt=new Date().toISOString();job.result=result;job.error=error;await writeStore(store);return job;}
export async function listMacJobs(userId,limit=50){const store=await readStore();return store.jobs.filter(j=>j.userId===userId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit);}
