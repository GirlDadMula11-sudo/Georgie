import crypto from "crypto";
import { readCloudState, writeCloudState } from "./cloud-state.js";
const NS="events";
async function readStore(userId="primary"){const s=await readCloudState(userId,NS,{events:[]});return{events:Array.isArray(s.events)?s.events:[]};}
async function writeStore(userId,store){await writeCloudState(userId,NS,store);}
export async function enqueueEvent({userId,type,title,body="",priority="normal",dedupeKey=null,data={}}){const uid=String(userId||"primary");const store=await readStore(uid);if(dedupeKey&&store.events.some(e=>e.userId===uid&&e.dedupeKey===dedupeKey))return null;const event={id:crypto.randomUUID(),userId:uid,type,title,body,priority,dedupeKey,data,status:"pending",createdAt:new Date().toISOString(),acknowledgedAt:null};store.events.push(event);store.events=store.events.slice(-5000);await writeStore(uid,store);return event;}
export async function listEvents(userId,{status="pending",limit=30}={}){const uid=String(userId||"primary");const store=await readStore(uid);return store.events.filter(e=>e.userId===uid&&(status==="all"||e.status===status)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,Math.max(1,Math.min(Number(limit)||30,200)));}
export async function acknowledgeEvent(userId,eventId){const uid=String(userId||"primary");const store=await readStore(uid);const event=store.events.find(e=>e.userId===uid&&e.id===eventId);if(!event)return null;event.status="acknowledged";event.acknowledgedAt=new Date().toISOString();await writeStore(uid,store);return event;}
