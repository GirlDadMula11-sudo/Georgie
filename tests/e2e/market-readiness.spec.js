import { test,expect } from "@playwright/test";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";

const appPort=4310,providerPort=4311,enrollmentCode="MARKET-READY-2026";
const codeHash=crypto.createHash("sha256").update(enrollmentCode).digest("hex");
const states=new Map();let device=null,app=null,provider=null,dataRoot=null;

function json(res,status,value){res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(value));}
function stateKey(body){return `${body.p_user_id||"primary"}\0${body.p_namespace}`;}
function startProvider(){return new Promise(resolve=>{provider=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};const url=new URL(req.url,"http://mock");
  if(url.pathname.includes("georgie_mobile_enrollment_codes")&&req.method==="GET")return json(res,200,url.searchParams.get("code_hash")==`eq.${codeHash}`?[{id:"code-1",code_hash:codeHash,active:true,expires_at:new Date(Date.now()+60_000).toISOString()}]:[]);
  if(url.pathname.includes("georgie_mobile_enrollment_codes")&&req.method==="PATCH")return json(res,200,{});
  if(url.pathname.includes("georgie_mobile_devices")&&req.method==="POST"){device={id:"device-1",...body};return json(res,201,{});}
  if(url.pathname.includes("georgie_mobile_devices")&&req.method==="GET")return json(res,200,device?[device]:[]);
  if(url.pathname.includes("georgie_mobile_devices")&&req.method==="PATCH")return json(res,200,{});
  if(url.pathname.startsWith("/rest/v1/rpc/georgie_get_"))return json(res,200,states.get(stateKey(body))||{});
  if(url.pathname.startsWith("/rest/v1/rpc/georgie_put_")){states.set(stateKey(body),body.p_state||{});return json(res,200,true);}
  if(url.pathname.startsWith("/rest/v1/rpc/georgie_patch_")){const prior=states.get(stateKey(body))||{};states.set(stateKey(body),{...prior,...body.p_head});return json(res,200,true);}
  return json(res,200,[]);
}).listen(providerPort,"127.0.0.1",resolve);});}
async function waitForHealth(){for(let i=0;i<80;i+=1){try{const response=await fetch(`http://127.0.0.1:${appPort}/health`);if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error("Georgie fixture did not become ready");}
async function startApp(){dataRoot=await mkdtemp(path.join(os.tmpdir(),"georgie-market-e2e-"));app=spawn(process.execPath,["src/runtime.js"],{cwd:process.cwd(),env:{...process.env,PORT:String(appPort),NODE_ENV:"production",OPENAI_API_KEY:"market-test",GEORGIE_SUPABASE_URL:`http://127.0.0.1:${providerPort}`,GEORGIE_SUPABASE_SERVICE_ROLE_KEY:"test-service-role",GEORGIE_DATA_DIR:dataRoot,GEORGIE_RUNTIME_MODE:"kernel"},stdio:["ignore","pipe","pipe"]});await waitForHealth();}
async function stopApp(){if(!app)return;app.kill("SIGTERM");await new Promise(resolve=>{const timer=setTimeout(resolve,2000);app.once("exit",()=>{clearTimeout(timer);resolve();});});app=null;}

test.beforeAll(async()=>{await startProvider();await startApp();});
test.afterAll(async()=>{await stopApp();await new Promise(resolve=>provider.close(resolve));});

test("activation and durable tasks survive a clean runtime restart",async({page})=>{
  const consoleErrors=[];page.on("console",message=>{if(message.type()==="error")consoleErrors.push(message.text());});
  await page.goto("/");await expect(page.getByRole("heading",{name:"Activate Georgie"})).toBeVisible();
  await page.getByPlaceholder("Enrollment code").fill(enrollmentCode);await page.getByRole("button",{name:"Activate this device"}).click();
  await expect(page.locator("#enrollmentGate")).toBeHidden();await expect(page.getByPlaceholder("Message Georgie…")).toBeVisible();
  const title=`Market durability ${Date.now()}`;
  const created=await page.evaluate(async title=>{const token=localStorage.getItem("georgie:deviceToken"),deviceId=localStorage.getItem("georgie:deviceId");const response=await fetch("/api/tasks",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`,"x-georgie-device":deviceId},body:JSON.stringify({title})});return{status:response.status,body:await response.json()};},title);
  expect(created.status).toBe(201);expect(created.body.task.title).toBe(title);expect(states.get("primary\0tasks").tasks.some(item=>item.title===title)).toBe(true);
  await stopApp();await startApp();await page.reload();await expect(page.locator("#enrollmentGate")).toBeHidden();
  const tasks=await page.evaluate(async()=>{const token=localStorage.getItem("georgie:deviceToken"),deviceId=localStorage.getItem("georgie:deviceId");const response=await fetch("/api/tasks?status=all",{headers:{authorization:`Bearer ${token}`,"x-georgie-device":deviceId}});return response.json();});
  expect(tasks.tasks.some(item=>item.title===title)).toBe(true);expect(consoleErrors).toEqual([]);
  await page.screenshot({path:"test-results/market-ready.png",fullPage:true});
});
