import { Router } from "express";
import multer from "multer";
import { askGeorgie, extractMemoryCandidates, planActions, synthesizeSpeech, transcribeAudio } from "./georgie.js";
import { addMemory, appendSessionTurn, buildMemoryContext, getSessionHistory } from "./memory.js";
import { listTasks } from "./tasks.js";
import { executeTool, listToolDefinitions } from "./tools.js";
import { authenticateNativeRequest, enrollNativeDevice, nativeAuthStatus } from "./mobile-auth.js";

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
const router=Router();
const userIdFor=()=>String(process.env.GEORGIE_PRIMARY_USER_ID||"primary").slice(0,100);
const sessionIdFor=req=>String(req.headers["x-georgie-session"]||"native").slice(0,150);

async function remember(userId,userText,assistantText){try{const items=await extractMemoryCandidates(userText,assistantText);await Promise.all(items.map(memory=>addMemory({userId,...memory,source:"ios-native"})));return items.length}catch{return 0}}
async function complete(userId,sessionId,input){const history=await getSessionHistory(userId,sessionId,16),memory=await buildMemoryContext(userId,input),policy=process.env.GEORGIE_AUTO_ACTION_POLICY||"low_risk_write",planned=await planActions(input,listToolDefinitions({workforce:true})),actions=[];for(const action of planned)actions.push(await executeTool({name:action.tool,args:action.args||{},userId,policy,workforce:true}));const tasks=await listTasks(userId,{status:"open",limit:8}),parts=[memory.prompt];if(tasks.length)parts.push(`OPEN TASKS\n${tasks.map(t=>`- ${t.title}${t.dueAt?` (due ${t.dueAt})`:""}`).join("\n")}`);if(actions.length)parts.push(`TOOL EXECUTION RESULTS\n${JSON.stringify(actions).slice(0,10000)}`);const response=await askGeorgie(input,history,parts.filter(Boolean).join("\n\n"));await appendSessionTurn({userId,sessionId,role:"user",content:input});await appendSessionTurn({userId,sessionId,role:"assistant",content:response.text});const remembered=await remember(userId,input,response.text);return{...response,remembered,actions}}

router.get("/status",(_req,res)=>res.json({ok:true,...nativeAuthStatus()}));
router.post("/enroll",async(req,res)=>{try{const token=await enrollNativeDevice({code:req.body?.code,deviceId:req.body?.deviceId,deviceName:req.body?.deviceName||"iPhone",platform:"ios"});res.json({ok:true,token})}catch(error){res.status(403).json({ok:false,error:error instanceof Error?error.message:"Enrollment failed"})}});
router.use(async(req,res,next)=>{try{const device=await authenticateNativeRequest(req);if(!device)return res.status(401).json({ok:false,error:"Native device authentication required"});const claimed=String(req.headers["x-georgie-device"]||"");if(claimed&&claimed!==device.device_id)return res.status(401).json({ok:false,error:"Native device identity mismatch"});req.georgieDevice=device;next()}catch(error){res.status(503).json({ok:false,error:"Native authentication temporarily unavailable"})}});
router.get("/device",(req,res)=>res.json({ok:true,deviceId:req.georgieDevice.device_id,deviceName:req.georgieDevice.device_name||null,platform:req.georgieDevice.platform||null}));
router.get("/tasks",async(req,res)=>{try{res.json({ok:true,tasks:await listTasks(userIdFor(req),{status:"open",limit:30})})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Task load failed"})}});
router.post("/respond",async(req,res)=>{try{const input=String(req.body?.input||"").trim();if(!input)return res.status(400).json({ok:false,error:"Input is required"});res.json({ok:true,...await complete(userIdFor(req),sessionIdFor(req),input)})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Response failed"})}});
router.post("/voice-turn",upload.single("audio"),async(req,res)=>{try{if(!req.file)return res.status(400).json({ok:false,error:"Audio is required"});const userId=userIdFor(req),sessionId=sessionIdFor(req),transcript=await transcribeAudio({buffer:req.file.buffer,mimeType:req.file.mimetype,filename:req.file.originalname}),response=await complete(userId,sessionId,transcript),speech=await synthesizeSpeech(response.text);res.json({ok:true,transcript,text:response.text,responseId:response.responseId,remembered:response.remembered,actions:response.actions,audioBase64:speech.toString("base64"),audioMimeType:"audio/mpeg"})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Voice turn failed"})}});

export function createMobileRouter(){return router;}
