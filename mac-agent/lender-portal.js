import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
const execFile = promisify(execFileCb);
const osa = async script => (await execFile("osascript", ["-e", script], { timeout: 45000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const jsString = value => JSON.stringify(String(value ?? ""));
function hostOf(value) { try { return new URL(String(value)).hostname.toLowerCase(); } catch { return ""; } }
async function chromeJs(source) {
  const encoded = Buffer.from(String(source)).toString("base64");
  const script = `tell application "Google Chrome"\nif (count of windows) = 0 then make new window\nset payload to "${encoded}"\nset js to do shell script "printf %s " & quoted form of payload & " | base64 --decode"\nreturn execute active tab of front window javascript js\nend tell`;
  return osa(script);
}
export async function executeLenderPortalSubmit(args = {}) {
  const endpoint = String(args.endpoint || "").trim(), host = hostOf(endpoint), profile = args.portalProfile || null;
  if (!endpoint || !host || !/^https:\/\//i.test(endpoint)) return { blocked: true, reason: "PORTAL_ENDPOINT_NOT_VERIFIED", providerConfirmed: false };
  const allowed = Array.isArray(profile?.allowedHosts) ? profile.allowedHosts.map(x => String(x).toLowerCase()) : [];
  if (!profile || !allowed.includes(host)) return { blocked: true, reason: "PORTAL_ADAPTER_PROFILE_REQUIRED", endpointHost: host, providerConfirmed: false };
  if (profile.requiresNewMerchantConsent === true) return { blocked: true, reason: "NEW_MERCHANT_CONSENT_REQUIRED", endpointHost: host, providerConfirmed: false };
  await osa(`tell application "Google Chrome"\nactivate\nif (count of windows) = 0 then make new window\nset URL of active tab of front window to ${jsString(endpoint)}\nend tell`);
  await new Promise(r => setTimeout(r, Math.max(1500, Math.min(10000, Number(profile.loadWaitMs || 2500)))));
  const schemaRaw = await chromeJs(`(()=>JSON.stringify({url:location.href,title:document.title,forms:[...document.forms].map(f=>({action:f.action,method:f.method,inputs:[...f.elements].slice(0,150).map(e=>({tag:e.tagName,type:e.type||'',name:e.name||'',id:e.id||'',required:!!e.required,aria:e.getAttribute('aria-label')||''}))}))}))()`);
  let schema = {}; try { schema = JSON.parse(schemaRaw || "{}"); } catch {}
  if (!Array.isArray(profile.steps) || !profile.steps.length) return { blocked: true, reason: "PORTAL_ADAPTER_STEPS_REQUIRED", endpointHost: host, observed: schema, providerConfirmed: false };
  for (const step of profile.steps) {
    if (step.type === "click") {
      const selector = String(step.selector || ""); if (!selector) throw new Error("PORTAL_PROFILE_CLICK_SELECTOR_REQUIRED");
      const result = await chromeJs(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'missing';e.click();return 'clicked'})()`); if (result !== "clicked") return { blocked: true, reason: "PORTAL_SELECTOR_MISSING", selector, observed: schema, providerConfirmed: false };
      await new Promise(r => setTimeout(r, Math.max(300, Math.min(5000, Number(step.waitMs || 700)))));
    } else if (step.type === "fill") {
      const selector = String(step.selector || ""), value = String(step.value ?? ""); if (!selector) throw new Error("PORTAL_PROFILE_FILL_SELECTOR_REQUIRED");
      const result = await chromeJs(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'missing';const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;if(s)s.call(e,${JSON.stringify(value)});else e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 'filled'})()`); if (result !== "filled") return { blocked: true, reason: "PORTAL_SELECTOR_MISSING", selector, observed: schema, providerConfirmed: false };
    } else return { blocked: true, reason: "PORTAL_PROFILE_STEP_NOT_ALLOWED", stepType: String(step.type || ""), providerConfirmed: false };
  }
  await new Promise(r => setTimeout(r, Math.max(800, Math.min(10000, Number(profile.confirmWaitMs || 2000)))));
  const proofRaw = await chromeJs(`(()=>JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,12000)}))()`);let proof={};try{proof=JSON.parse(proofRaw||"{}")}catch{}
  const successUrl = profile.successUrlIncludes && String(proof.url||"").includes(String(profile.successUrlIncludes));
  const successText = profile.successText && String(proof.text||"").toLowerCase().includes(String(profile.successText).toLowerCase());
  if (!successUrl && !successText) return { blocked: true, reason: "PROVIDER_CONFIRMATION_NOT_OBSERVED", observed: { url: proof.url, title: proof.title }, providerConfirmed: false };
  return { providerConfirmed: true, providerReference: String(proof.url || "").slice(0, 1000), confirmation: { url: proof.url, title: proof.title }, endpointHost: host };
}
