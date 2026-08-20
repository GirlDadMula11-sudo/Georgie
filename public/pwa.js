import {authHeaders,georgieDeviceReady} from "./device-auth.js";
function decodeKey(value){const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}
async function enablePush(registration,{requestPermission=false}={}){await georgieDeviceReady;const configResponse=await fetch("/api/mobile/push/config",{headers:authHeaders()}),config=await configResponse.json();if(!config.configured)throw new Error("Push notifications are not activated on the server yet");if(requestPermission&&Notification.permission==="default")await Notification.requestPermission();if(Notification.permission!=="granted")return false;const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(config.publicKey)});await fetch("/api/mobile/push/subscribe",{method:"POST",headers:authHeaders({"Content-Type":"application/json"}),body:JSON.stringify({subscription})});return true;}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(async registration=>{if(Notification.permission==="granted")await enablePush(registration);document.querySelector("#notificationButton")?.addEventListener("click",async()=>{try{const enabled=await enablePush(registration,{requestPermission:true});document.querySelector("#status").textContent=enabled?"Notifications are on. Georgie can reach you with important updates.":"Notifications remain off.";}catch(error){document.querySelector("#status").textContent=error.message||"Notifications could not be enabled.";}});}).catch((error) => {
      console.warn("Georgie service worker unavailable", error);
    });
  });
}

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  document.documentElement.dataset.installable = "true";
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.documentElement.dataset.installable = "false";
});

export async function installGeorgie() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  return true;
}
