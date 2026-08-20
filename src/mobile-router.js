import { Router } from "express";
import multer from "multer";
import { spokenResponseFor, synthesizeSpeech, transcribeAudio } from "./georgie.js";
import { getSessionHistory } from "./memory.js";
import { listTasks } from "./tasks.js";
import { authenticateNativeRequest, enrollNativeDevice, nativeAuthStatus } from "./mobile-auth.js";
import { acknowledgeEvent, listEvents } from "./events.js";
import { pushStatus, removePushSubscription, savePushSubscription } from "./push-notifications.js";
import { buildCommandCenter } from "./command-layer.js";
import { certificationStatus, certifyRunbook, executeCertifiedRepair, listRepairRunbooks } from "./repair-runbooks.js";
import { maintenanceStatus } from "./maintenance-sentinel.js";
import { completeTurnV2 } from "./v2-turn-engine.js";
import { recordClientTelemetry, recordOutcomeFeedback } from "./evaluation.js";

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
const router=Router();
const userIdFor=()=>String(process.env.GEORGIE_PRIMARY_USER_ID||"primary").slice(0,100);
const sessionIdFor=req=>String(req.headers["x-georgie-session"]||"native").slice(0,150);

async function complete(userId,sessionId,input,options={}){return completeTurnV2({userId,sessionId,input,history:options.history||[],onProgress:options.onProgress});}

router.get("/status",(_req,res)=>res.json({ok:true,...nativeAuthStatus()}));
router.post("/enroll",async(req,res)=>{try{const platform=["ios","pwa","macos"].includes(req.body?.platform)?req.body.platform:"pwa";const token=await enrollNativeDevice({code:req.body?.code,deviceId:req.body?.deviceId,deviceName:req.body?.deviceName||"Georgie device",platform});res.json({ok:true,token,platform})}catch(error){res.status(403).json({ok:false,error:error instanceof Error?error.message:"Enrollment failed"})}});
router.use(async(req,res,next)=>{try{const device=await authenticateNativeRequest(req);if(!device)return res.status(401).json({ok:false,error:"Native device authentication required"});const claimed=String(req.headers["x-georgie-device"]||"");if(claimed&&claimed!==device.device_id)return res.status(401).json({ok:false,error:"Native device identity mismatch"});req.georgieDevice=device;next()}catch(error){res.status(503).json({ok:false,error:"Native authentication temporarily unavailable"})}});
router.get("/device",(req,res)=>res.json({ok:true,deviceId:req.georgieDevice.device_id,deviceName:req.georgieDevice.device_name||null,platform:req.georgieDevice.platform||null}));
router.get("/tasks",async(req,res)=>{try{res.json({ok:true,tasks:await listTasks(userIdFor(req),{status:"open",limit:30})})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Task load failed"})}});
router.get("/session",async(req,res)=>{try{res.json({ok:true,history:await getSessionHistory(userIdFor(req),sessionIdFor(req),Number(req.query?.limit||40))})}catch(error){res.status(500).json({ok:false,error:"Session load failed"})}});
router.get("/inbox",async(req,res)=>{try{res.json({ok:true,events:await listEvents(userIdFor(req),{status:req.query?.status||"all",limit:req.query?.limit||100})})}catch(error){res.status(500).json({ok:false,error:"Inbox load failed"})}});
router.post("/inbox/:id/ack",async(req,res)=>{const event=await acknowledgeEvent(userIdFor(req),req.params.id);res.status(event?200:404).json({ok:Boolean(event),event});});
router.get("/push/config",(_req,res)=>res.json({ok:true,...pushStatus()}));
router.post("/push/subscribe",async(req,res)=>{try{res.json({ok:true,subscription:await savePushSubscription(userIdFor(req),req.georgieDevice.device_id,req.body?.subscription)})}catch(error){res.status(400).json({ok:false,error:error instanceof Error?error.message:"Push registration failed"})}});
router.delete("/push/subscribe",async(req,res)=>{await removePushSubscription(userIdFor(req),req.georgieDevice.device_id);res.json({ok:true});});
router.get("/command-center",async(_req,res)=>res.json({ok:true,commandCenter:await buildCommandCenter(userIdFor(),{refreshSierra:false})}));
router.get("/repairs",async(_req,res)=>{const maintenance=await maintenanceStatus(userIdFor());res.json({ok:true,runbooks:listRepairRunbooks(),certification:await certificationStatus(userIdFor(),maintenance)});});
router.post("/repairs/:id/certify",async(req,res)=>{try{res.json({ok:true,result:await certifyRunbook(userIdFor(),req.params.id)})}catch(error){res.status(400).json({ok:false,error:error instanceof Error?error.message:"Certification failed"})}});
router.post("/repairs/:id/execute",async(req,res)=>{try{const maintenance=await maintenanceStatus(userIdFor()),cert=await certificationStatus(userIdFor(),maintenance);if(!cert.certified)return res.status(409).json({ok:false,error:"Bounded repair mode is not certified"});res.json(await executeCertifiedRepair(userIdFor(),req.params.id))}catch(error){res.status(400).json({ok:false,error:error instanceof Error?error.message:"Repair failed"})}});
router.post("/respond",async(req,res)=>{try{const input=String(req.body?.input||"").trim();if(!input)return res.status(400).json({ok:false,error:"Input is required"});const response=await complete(userIdFor(req),sessionIdFor(req),input);res.json({ok:true,...response,spokenText:spokenResponseFor(input,response.text)})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Response failed"})}});
router.post("/respond/stream",async(req,res)=>{const input=String(req.body?.input||"").trim();if(!input)return res.status(400).json({ok:false,error:"Input is required"});res.status(200);res.setHeader("Content-Type","application/x-ndjson; charset=utf-8");res.setHeader("Cache-Control","no-cache, no-transform");res.setHeader("X-Accel-Buffering","no");res.flushHeaders?.();const send=event=>{if(!res.writableEnded)res.write(`${JSON.stringify(event)}\n`);};try{const response=await complete(userIdFor(req),sessionIdFor(req),input,{history:Array.isArray(req.body?.history)?req.body.history:[],onProgress:send});send({type:"final",ok:true,spokenText:spokenResponseFor(input,response.text),result:response});}catch(error){send({type:"error",ok:false,error:error instanceof Error?error.message:"Streaming response failed"});}finally{if(!res.writableEnded)res.end();}});
router.post("/telemetry",async(req,res)=>{try{res.status(202).json({ok:true,telemetry:await recordClientTelemetry(userIdFor(req),req.body||{})});}catch(error){res.status(500).json({ok:false,error:"Telemetry unavailable"});}});
router.post("/feedback",async(req,res)=>{try{res.status(201).json({ok:true,feedback:await recordOutcomeFeedback(userIdFor(req),req.body||{})});}catch(error){res.status(500).json({ok:false,error:"Feedback unavailable"});}});
router.post("/transcribe",upload.single("audio"),async(req,res)=>{try{if(!req.file)return res.status(400).json({ok:false,error:"Audio is required"});res.json({ok:true,text:await transcribeAudio({buffer:req.file.buffer,mimeType:req.file.mimetype,filename:req.file.originalname})})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Transcription failed"})}});
router.post("/speak",async(req,res)=>{try{const audio=await synthesizeSpeech(req.body?.text);res.setHeader("Content-Type","audio/mpeg");res.setHeader("Cache-Control","no-store");res.send(audio)}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Speech failed"})}});
router.post("/voice-turn",upload.single("audio"),async(req,res)=>{try{if(!req.file)return res.status(400).json({ok:false,error:"Audio is required"});const userId=userIdFor(req),sessionId=sessionIdFor(req),transcript=await transcribeAudio({buffer:req.file.buffer,mimeType:req.file.mimetype,filename:req.file.originalname}),response=await complete(userId,sessionId,transcript),spokenText=spokenResponseFor(transcript,response.text),speech=await synthesizeSpeech(spokenText);res.json({ok:true,transcript,text:response.text,spokenText,responseId:response.responseId,remembered:response.remembered,actions:response.actions,audioBase64:speech.toString("base64"),audioMimeType:"audio/mpeg"})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Voice turn failed"})}});

export function createMobileRouter(){return router;}
