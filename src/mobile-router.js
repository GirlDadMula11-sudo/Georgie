import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { spokenResponseFor, synthesizeSpeech, transcribeAudio } from "./georgie.js";
import { getConversationHistory, getSessionHistory } from "./memory.js";
import { listTasks } from "./tasks.js";
import { authenticateNativeRequest, createEnrollmentCode, enrollNativeDevice, nativeAuthStatus } from "./mobile-auth.js";
import { acknowledgeEvent, listEvents } from "./events.js";
import { pushStatus, removePushSubscription, savePushSubscription } from "./push-notifications.js";
import { buildCommandCenter } from "./command-layer.js";
import { certificationStatus, certifyRunbook, executeCertifiedRepair, listRepairRunbooks } from "./repair-runbooks.js";
import { maintenanceStatus } from "./maintenance-sentinel.js";
import { completeAttachmentTurnV2, completeTurnV2 } from "./v2-turn-engine.js";
import { MAX_ATTACHMENTS_PER_TURN, persistAttachments, publicAttachmentManifest } from "./attachments.js";
import { recordClientTelemetry, recordOutcomeFeedback, recordTurnEvaluation } from "./evaluation.js";
import { terminalPartialResult, withTurnDeadline } from "./turn-lifecycle.js";
import { appendSessionTurn } from "./memory.js";
import { enhanceOutcomeResponse } from "./outcome-lifecycle.js";
import { retainTurnContinuation } from "./operating-graph.js";
import { beginDurableTurn, getDurableTurn, listRecoverableTurns, runDurableTurn } from "./durable-turn-runtime.js";
import { checkpointReportDelivery, investigationArtifactPage, listInvestigationArtifacts, openInvestigationArtifact } from "./investigation-artifacts.js";

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
const router=Router();
const userIdFor=()=>String(process.env.GEORGIE_PRIMARY_USER_ID||"primary").slice(0,100);
const sessionIdFor=req=>String(req.headers["x-georgie-session"]||"native").slice(0,150);

async function complete(userId, sessionId, input, options = {}) {
  const startedAt = Date.now();
  let response;
  try {
    response = await withTurnDeadline(
    () => (options.attachments?.length ? completeAttachmentTurnV2 : completeTurnV2)({
      userId,
      sessionId,
      input,
      history: options.history || [],
      attachments: options.attachments || [],
      onProgress: options.onProgress,
      shouldFinalize: () => true,
    }),
    {
      timeoutMs: options.durableStream ? null : undefined,
      onDeadline: () => {
        const result = terminalPartialResult({ startedAt });
        options.onProgress?.({
          type: "status",
          stage: "background_continuation",
          message: "The foreground response window ended, but the accepted work is still running and its late verified result remains eligible for persistence. No manual resume is required.",
          elapsedMs: result.latencyMs,
        });
        void Promise.race([
          Promise.all([
            appendSessionTurn({ userId, sessionId, role: "user", content: input }),
            appendSessionTurn({ userId, sessionId, role: "assistant", content: result.text }),
            recordTurnEvaluation(userId, {
              route: result.route,
              model: result.model,
              latencyMs: result.latencyMs,
              firstResponseMs: result.firstResponseMs,
              contextReadyMs: result.contextReadyMs,
              toolCount: 0,
              evidence: [],
              responseCharacters: result.text.length,
              completed: false,
              actionSuccess: null,
            }),
          ]),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]).catch((error) => console.warn("Georgie continuation-state persistence delayed:", error instanceof Error ? error.message : error));
        return result;
      },
    },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Turn execution failed");
    const timedOut = /abort|timeout|deadline/i.test(message);
    response = terminalPartialResult({ startedAt, reason: timedOut ? "provider_timeout" : "turn_execution_failure", detail: message });
    options.onProgress?.({
      type: "status",
      stage: "background_continuation",
      message: timedOut
        ? "The intelligence provider reached its bounded timeout. The objective remains retained for automatic recovery; no manual resume is required."
        : "The active execution path failed safely. The objective remains retained for governed recovery and nothing unfinished is being claimed as complete.",
      elapsedMs: response.latencyMs,
    });
    await Promise.race([
      Promise.all([
        appendSessionTurn({ userId, sessionId, role: "user", content: input }),
        appendSessionTurn({ userId, sessionId, role: "assistant", content: response.text }),
        recordTurnEvaluation(userId, { route: response.route, model: response.model, latencyMs: response.latencyMs, firstResponseMs: response.firstResponseMs, contextReadyMs: response.contextReadyMs, toolCount: 0, evidence: [], responseCharacters: response.text.length, completed: false, actionSuccess: false }),
      ]),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]).catch((persistenceError) => console.warn("Georgie failure-state persistence delayed:", persistenceError instanceof Error ? persistenceError.message : persistenceError));
  }
  const enhanced = enhanceOutcomeResponse(response);
  if (enhanced.outcome.requiresFollowUp || enhanced.outcome.requiresRecovery) {
    setImmediate(() => retainTurnContinuation(userId, sessionId, input, enhanced).catch((error) => console.warn("Turn continuity persistence delayed:", error instanceof Error ? error.message : error)));
  }
  return enhanced;
}

router.get("/status",(_req,res)=>res.json({ok:true,...nativeAuthStatus()}));
router.post("/enroll",async(req,res)=>{try{const platform=["ios","pwa","macos"].includes(req.body?.platform)?req.body.platform:"pwa";const token=await enrollNativeDevice({code:req.body?.code,deviceId:req.body?.deviceId,deviceName:req.body?.deviceName||"Georgie device",platform});res.json({ok:true,token,platform})}catch(error){res.status(403).json({ok:false,error:error instanceof Error?error.message:"Enrollment failed"})}});
router.use(async(req,res,next)=>{try{const device=await authenticateNativeRequest(req);if(!device)return res.status(401).json({ok:false,error:"Native device authentication required"});const claimed=String(req.headers["x-georgie-device"]||"");if(claimed&&claimed!==device.device_id)return res.status(401).json({ok:false,error:"Native device identity mismatch"});req.georgieDevice=device;next()}catch(error){res.status(503).json({ok:false,error:"Native authentication temporarily unavailable"})}});
router.get("/device",(req,res)=>res.json({ok:true,deviceId:req.georgieDevice.device_id,deviceName:req.georgieDevice.device_name||null,platform:req.georgieDevice.platform||null}));
router.get("/turns/:requestId",async(req,res)=>{try{const job=await getDurableTurn(userIdFor(req),String(req.params.requestId||""));if(!job)return res.status(404).json({ok:false,error:"Durable request was not found"});res.setHeader("Cache-Control","no-store");res.json({ok:true,job});}catch(error){res.status(503).json({ok:false,error:error instanceof Error?error.message:"Durable request status is temporarily unavailable"});}});
router.post("/enrollment-code",async(_req,res)=>{try{res.setHeader("Cache-Control","no-store");res.status(201).json({ok:true,...await createEnrollmentCode()})}catch(error){res.status(503).json({ok:false,error:error instanceof Error?error.message:"Enrollment code creation failed"})}});
router.get("/tasks",async(req,res)=>{try{res.json({ok:true,tasks:await listTasks(userIdFor(req),{status:"open",limit:30})})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Task load failed"})}});
router.get("/session",async(req,res)=>{try{const limit=Number(req.query?.limit||200),all=req.query?.scope!=="session";res.json({ok:true,scope:all?"continuous":"session",history:all?await getConversationHistory(userIdFor(req),limit):await getSessionHistory(userIdFor(req),sessionIdFor(req),limit)})}catch(error){res.status(500).json({ok:false,error:"Session load failed"})}});
router.get("/inbox",async(req,res)=>{try{res.json({ok:true,events:await listEvents(userIdFor(req),{status:req.query?.status||"all",limit:req.query?.limit||100})})}catch(error){res.status(500).json({ok:false,error:"Inbox load failed"})}});
router.post("/inbox/:id/ack",async(req,res)=>{const event=await acknowledgeEvent(userIdFor(req),req.params.id);res.status(event?200:404).json({ok:Boolean(event),event});});
router.get("/push/config",(_req,res)=>res.json({ok:true,...pushStatus()}));
router.post("/push/subscribe",async(req,res)=>{try{res.json({ok:true,subscription:await savePushSubscription(userIdFor(req),req.georgieDevice.device_id,req.body?.subscription)})}catch(error){res.status(400).json({ok:false,error:error instanceof Error?error.message:"Push registration failed"})}});
router.delete("/push/subscribe",async(req,res)=>{await removePushSubscription(userIdFor(req),req.georgieDevice.device_id);res.json({ok:true});});
router.get("/command-center",async(_req,res)=>res.json({ok:true,commandCenter:await buildCommandCenter(userIdFor(),{refreshSierra:false})}));
router.get("/investigations",async(req,res)=>{try{res.setHeader("Cache-Control","no-store");res.json({ok:true,artifacts:await listInvestigationArtifacts(userIdFor(req),{limit:req.query?.limit||20})})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Investigation artifacts unavailable"})}});
router.get("/investigations/:id",async(req,res)=>{try{res.setHeader("Cache-Control","no-store");const artifact=await openInvestigationArtifact(userIdFor(req),req.params.id),page=investigationArtifactPage(artifact,{cursor:req.query?.cursor,includeRaw:req.query?.includeRaw==="true",maxBytes:req.query?.maxBytes});res.status(page?200:404).json({ok:Boolean(page),artifact:page})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Investigation artifact unavailable"})}});
router.post("/investigations/:id/delivery",async(req,res)=>{try{res.setHeader("Cache-Control","no-store");res.json({ok:true,artifact:await checkpointReportDelivery(userIdFor(req),req.params.id,req.body||{})})}catch(error){res.status(409).json({ok:false,error:error instanceof Error?error.message:"Report delivery checkpoint failed"})}});
router.get("/repairs",async(_req,res)=>{const maintenance=await maintenanceStatus(userIdFor());res.json({ok:true,runbooks:listRepairRunbooks(),certification:await certificationStatus(userIdFor(),maintenance)});});
router.post("/repairs/:id/certify",async(req,res)=>{try{res.json({ok:true,result:await certifyRunbook(userIdFor(),req.params.id)})}catch(error){res.status(400).json({ok:false,error:error instanceof Error?error.message:"Certification failed"})}});
router.post("/repairs/:id/execute",async(req,res)=>{try{const maintenance=await maintenanceStatus(userIdFor()),cert=await certificationStatus(userIdFor(),maintenance);if(!cert.certified)return res.status(409).json({ok:false,error:"Bounded repair mode is not certified"});res.json(await executeCertifiedRepair(userIdFor(),req.params.id))}catch(error){res.status(400).json({ok:false,error:error instanceof Error?error.message:"Repair failed"})}});
router.post("/respond",async(req,res)=>{try{const input=String(req.body?.input||"").trim();if(!input)return res.status(400).json({ok:false,error:"Input is required"});const response=await complete(userIdFor(req),sessionIdFor(req),input);res.json({ok:true,...response,spokenText:spokenResponseFor(input,response.text)})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Response failed"})}});
router.post("/respond/stream",async(req,res)=>{
  const input=String(req.body?.input||"").trim();if(!input)return res.status(400).json({ok:false,error:"Input is required"});
  const requestId=crypto.randomUUID(),started=Date.now(),userId=userIdFor(req),sessionId=sessionIdFor(req),history=Array.isArray(req.body?.history)?req.body.history:[];
  console.log(`[Georgie] turn accepted ${JSON.stringify({requestId,inputLength:input.length})}`);
  res.status(200);res.setHeader("Content-Type","application/x-ndjson; charset=utf-8");res.setHeader("Cache-Control","no-cache, no-transform");res.setHeader("X-Accel-Buffering","no");res.setHeader("X-Georgie-Request-Id",requestId);res.flushHeaders?.();
  const send=event=>{if(!res.writableEnded&&!res.destroyed)res.write(`${JSON.stringify({...event,requestId})}\n`);};
  send({type:"status",stage:"accepted",message:"Got it.",elapsedMs:0});
  const job=await beginDurableTurn({requestId,userId,sessionId,input,history,recoverable:/\b(?:continue|resume)\b/i.test(input)&&/\b(?:investigation|diagnosis|inspection|evidence)\b/i.test(input)});
  const heartbeat=setInterval(()=>send({type:"status",stage:"heartbeat",message:"Still working on this.",elapsedMs:Date.now()-started}),4000);heartbeat.unref?.();
  try{
    const response=await runDurableTurn({job,execute:({onProgress})=>complete(userId,sessionId,input,{history,onProgress,durableStream:true}),onProgress:send});
    send({type:"final",ok:true,spokenText:spokenResponseFor(input,response.text),result:{...response,requestId}});
    console.log(`[Georgie] turn terminal ${JSON.stringify({requestId,elapsedMs:Date.now()-started,completed:response.completed!==false,terminalReason:response.terminalReason||"completed",actionCount:response.actions?.length||0})}`);
  }catch(error){
    const blocker=error instanceof Error?error.message:"Streaming response failed";
    console.error(`[Georgie] turn failed ${JSON.stringify({requestId,elapsedMs:Date.now()-started,error:blocker})}`);
    send({type:"error",ok:false,error:`Blocked while executing the durable request: ${blocker}`,blocker,reconnect:`/api/mobile/turns/${requestId}`});
  }finally{clearInterval(heartbeat);if(!res.writableEnded)res.end();}
});
router.post("/respond/stream-with-files",upload.array("files",MAX_ATTACHMENTS_PER_TURN),async(req,res)=>{
  const input=String(req.body?.input||"Analyze the attached files.").trim();
  if(!req.files?.length)return res.status(400).json({ok:false,error:"At least one attachment is required"});
  let history=[];try{history=JSON.parse(req.body?.history||"[]");}catch{}
  const requestId=crypto.randomUUID(),started=Date.now();
  res.status(200);res.setHeader("Content-Type","application/x-ndjson; charset=utf-8");res.setHeader("Cache-Control","no-cache, no-transform");res.setHeader("X-Accel-Buffering","no");res.flushHeaders?.();
  const send=event=>{if(!res.writableEnded&&!res.destroyed)res.write(`${JSON.stringify(event)}\n`);};
  send({type:"status",stage:"uploading",message:`Securing ${req.files.length} attachment${req.files.length===1?"":"s"}…`,requestId,elapsedMs:0});
  try{
    const attachments=await persistAttachments({userId:userIdFor(req),sessionId:sessionIdFor(req),files:req.files});
    send({type:"attachments",attachments:publicAttachmentManifest(attachments)});
    const response=await complete(userIdFor(req),sessionIdFor(req),input,{history:Array.isArray(history)?history:[],attachments,onProgress:send,durableStream:true});
    send({type:"final",ok:true,spokenText:spokenResponseFor(input,response.text),result:response});
    console.log(`[Georgie] attachment turn terminal ${JSON.stringify({requestId,elapsedMs:Date.now()-started,fileCount:attachments.length,completed:response.completed!==false})}`);
  }catch(error){console.error(`[Georgie] attachment turn failed ${JSON.stringify({requestId,error:error instanceof Error?error.message:"Attachment response failed"})}`);send({type:"error",ok:false,error:error instanceof Error?error.message:"Attachment response failed"});}
  finally{if(!res.writableEnded)res.end();}
});
router.post("/telemetry",async(req,res)=>{try{res.status(202).json({ok:true,telemetry:await recordClientTelemetry(userIdFor(req),req.body||{})});}catch(error){res.status(500).json({ok:false,error:"Telemetry unavailable"});}});
router.post("/feedback",async(req,res)=>{try{res.status(201).json({ok:true,feedback:await recordOutcomeFeedback(userIdFor(req),req.body||{})});}catch(error){res.status(500).json({ok:false,error:"Feedback unavailable"});}});
router.post("/transcribe",upload.single("audio"),async(req,res)=>{try{if(!req.file)return res.status(400).json({ok:false,error:"Audio is required"});res.json({ok:true,text:await transcribeAudio({buffer:req.file.buffer,mimeType:req.file.mimetype,filename:req.file.originalname})})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Transcription failed"})}});
router.post("/speak",async(req,res)=>{try{const audio=await synthesizeSpeech(req.body?.text);res.setHeader("Content-Type","audio/mpeg");res.setHeader("Cache-Control","no-store");res.send(audio)}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Speech failed"})}});
router.post("/voice-turn",upload.single("audio"),async(req,res)=>{try{if(!req.file)return res.status(400).json({ok:false,error:"Audio is required"});const userId=userIdFor(req),sessionId=sessionIdFor(req),transcript=await transcribeAudio({buffer:req.file.buffer,mimeType:req.file.mimetype,filename:req.file.originalname}),response=await complete(userId,sessionId,transcript),spokenText=spokenResponseFor(transcript,response.text),speech=await synthesizeSpeech(spokenText);res.json({ok:true,transcript,text:response.text,spokenText,responseId:response.responseId,remembered:response.remembered,actions:response.actions,audioBase64:speech.toString("base64"),audioMimeType:"audio/mpeg"})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Voice turn failed"})}});

let recoveryStarted=false;
export function startMobileTurnRecovery(){
  if(recoveryStarted)return;recoveryStarted=true;
  setTimeout(async()=>{
    const userId=userIdFor();
    try{
      const jobs=await listRecoverableTurns(userId);
      for(const job of jobs.filter(item=>Number(item.attempts||0)<3)){
        console.log(`[Georgie] recovering durable read-only turn ${JSON.stringify({requestId:job.requestId,attempts:job.attempts||0})}`);
        runDurableTurn({job,execute:({onProgress})=>complete(userId,job.sessionId,job.input,{history:job.history||[],onProgress,durableStream:true})}).catch(()=>{});
      }
    }catch(error){console.warn("Durable turn recovery scan deferred:",error instanceof Error?error.message:error);}
  },1500).unref?.();
}
export function createMobileRouter(){return router;}
