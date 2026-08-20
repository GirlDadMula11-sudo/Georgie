const deviceId=localStorage.getItem("georgie:deviceId")||crypto.randomUUID();
localStorage.setItem("georgie:deviceId",deviceId);
let token=localStorage.getItem("georgie:deviceToken")||"";
let resolveReady;
export const georgieDeviceReady=new Promise(resolve=>{resolveReady=resolve;});
export function authHeaders(extra={}){return{Authorization:`Bearer ${token}`,"X-Georgie-Device":deviceId,"X-Georgie-Session":localStorage.getItem("georgie:sessionId")||"pwa",...extra};}
function showEnrollment(){const gate=document.querySelector("#enrollmentGate");gate.hidden=false;document.querySelector("#enrollmentForm")?.addEventListener("submit",async event=>{event.preventDefault();const code=document.querySelector("#enrollmentCode").value.trim(),message=document.querySelector("#enrollmentMessage");message.textContent="Activating this device…";try{const response=await fetch("/api/mobile/enroll",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,deviceId,deviceName:`${navigator.platform||"Safari"} Home Screen`,platform:"pwa"})}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||"Activation failed");token=payload.token;localStorage.setItem("georgie:deviceToken",token);gate.hidden=true;resolveReady(true);window.dispatchEvent(new CustomEvent("georgie:enrolled"));}catch(error){message.textContent=error.message||"Activation failed";}});}
async function boot(){if(token){try{const response=await fetch("/api/mobile/device",{headers:authHeaders()});if(response.ok){resolveReady(true);return;}}catch{}localStorage.removeItem("georgie:deviceToken");token="";}showEnrollment();}
boot();
