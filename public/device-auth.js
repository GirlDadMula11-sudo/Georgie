import {deviceAuthRetryDelay,isDefinitiveDeviceRejection} from "./device-auth-policy.js";

const deviceId=localStorage.getItem("georgie:deviceId")||crypto.randomUUID();
localStorage.setItem("georgie:deviceId",deviceId);
let token=localStorage.getItem("georgie:deviceToken")||"";
let resolveReady;
let enrollmentBound=false;
let retryAttempt=0;
export const georgieDeviceReady=new Promise(resolve=>{resolveReady=resolve;});
export function authHeaders(extra={}){return{Authorization:`Bearer ${token}`,"X-Georgie-Device":deviceId,"X-Georgie-Session":localStorage.getItem("georgie:sessionId")||"pwa",...extra};}
function showEnrollment(){const gate=document.querySelector("#enrollmentGate");gate.hidden=false;if(enrollmentBound)return;enrollmentBound=true;document.querySelector("#enrollmentForm")?.addEventListener("submit",async event=>{event.preventDefault();const code=document.querySelector("#enrollmentCode").value.trim(),message=document.querySelector("#enrollmentMessage");message.textContent="Activating this device…";try{const response=await fetch("/api/mobile/enroll",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,deviceId,deviceName:`${navigator.platform||"Safari"} Home Screen`,platform:"pwa"})}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||"Activation failed");token=payload.token;localStorage.setItem("georgie:deviceToken",token);gate.hidden=true;resolveReady(true);window.dispatchEvent(new CustomEvent("georgie:enrolled"));}catch(error){message.textContent=error.message||"Activation failed";}});}
function retryAuthentication(){const gate=document.querySelector("#enrollmentGate");if(gate)gate.hidden=true;const delay=deviceAuthRetryDelay(retryAttempt++);window.setTimeout(boot,delay);}
async function boot(){if(!token){showEnrollment();return;}try{const response=await fetch("/api/mobile/device",{headers:authHeaders()});if(response.ok){retryAttempt=0;resolveReady(true);return;}if(isDefinitiveDeviceRejection(response.status)){localStorage.removeItem("georgie:deviceToken");token="";showEnrollment();return;}}catch{}retryAuthentication();}
boot();
