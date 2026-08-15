import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.GEORGIE_DATA_DIR || (process.env.VERCEL ? "/tmp/georgie-data" : "data");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");
async function ensureStore(){await fs.mkdir(DATA_DIR,{recursive:true});try{await fs.access(EVENTS_FILE);}catch{await fs.writeFile(EVENTS_FILE,JSON.stringify({events:[]},null,2));}}
async function readStore(){await ensureStore();return JSON.parse(await fs.readFile(EVENTS_FILE,"utf8"));}
async function writeStore(store){await ensureStore();const temp=`${EVENTS_FILE}.${process.pid}.${Date.now()}.tmp`;await fs.writeFile(temp,JSON.stringify(store,null,2));await fs.rename(temp,EVENTS_FILE);}
export async function enqueueEvent({userId,type,title,body="",priority="normal",dedupeKey=null,data={}}){const store=await readStore();if(dedupeKey&&store.events.some(event=>event.userId===userId&&event.dedupeKey===dedupeKey))return null;const event={id:crypto.randomUUID(),userId,type,title,body,priority,dedupeKey,data,status:"pending",createdAt:new Date().toISOString(),acknowledgedAt:null};store.events.push(event);store.events=store.events.slice(-5000);await writeStore(store);return event;}
export async function listEvents(userId,{status="pending",limit=30}={}){const store=await readStore();return store.events.filter(event=>event.userId===userId&&(status==="all"||event.status===status)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,Math.max(1,Math.min(Number(limit)||30,200)));}
export async function acknowledgeEvent(userId,eventId){const store=await readStore();const event=store.events.find(item=>item.userId===userId&&item.id===eventId);if(!event)return null;event.status="acknowledged";event.acknowledgedAt=new Date().toISOString();await writeStore(store);return event;}
