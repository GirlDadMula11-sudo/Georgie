export function buildWordpressAdminJxaEnvelopeScript(serializedPageScript) {
  return `JSON.stringify((()=>{const chrome=Application('Google Chrome');if(!chrome.running())return{found:false,rawResult:null};for(const browserWindow of chrome.windows()){for(const browserTab of browserWindow.tabs()){const tabUrl=String(browserTab.url()||'');if(tabUrl.startsWith("https://sierramarketinginc.com/wp-admin/")){const rawResult=browserTab.execute({javascript:${JSON.stringify(serializedPageScript)}});return{found:true,rawResult:rawResult===undefined||rawResult===null?null:String(rawResult)}}}}return{found:false,rawResult:null}})())`;
}

export function parseWordpressAdminJxaEnvelope(rawEnvelope) {
  if (!rawEnvelope) throw new Error("WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED");
  let envelope;
  try {
    envelope = JSON.parse(rawEnvelope);
  } catch {
    throw new Error("WORDPRESS_JAVASCRIPT_RESULT_ENVELOPE_INVALID");
  }
  if (envelope?.found !== true) throw new Error("No approved Sierra WordPress admin tab");
  const rawResult = envelope.rawResult === undefined || envelope.rawResult === null ? "" : String(envelope.rawResult);
  if (!rawResult || rawResult === "missing value") throw new Error("WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED");
  try {
    return JSON.parse(rawResult);
  } catch {
    throw new Error("WORDPRESS_JAVASCRIPT_RESULT_PAYLOAD_INVALID");
  }
}

const RUN_START = "async function runWordpressAdminPageScript(pageScript){";
const RUN_END = "\nasync function executeSeoPhase2WordpressBatch";
const FIXED_RUN = [
  buildWordpressAdminJxaEnvelopeScript.toString(),
  parseWordpressAdminJxaEnvelope.toString(),
  "async function runWordpressAdminPageScript(pageScript){const serializedPageScript=`JSON.stringify(${pageScript})`;const script=buildWordpressAdminJxaEnvelopeScript(serializedPageScript);await execFileAsync(\"open\",[\"-a\",\"Google Chrome\",\"https://sierramarketinginc.com/wp-admin/\"],{timeout:15000});await new Promise(resolve=>setTimeout(resolve,3000));const rawEnvelope=await runJxa(script);return parseWordpressAdminJxaEnvelope(rawEnvelope)}"
].join("\n");

export function applyWordpressResultTransportRepair(source) {
  const text = String(source || "");
  if (text.includes("function buildWordpressAdminJxaEnvelopeScript") && text.includes("const rawEnvelope=await runJxa(script)")) {
    return { source: text, changed: false, status: "already_repaired" };
  }
  const start = text.indexOf(RUN_START);
  const end = start >= 0 ? text.indexOf(RUN_END, start) : -1;
  if (start < 0 || end < 0) throw new Error("SEO_PHASE2_RESULT_TRANSPORT_ANCHOR_MISSING");
  const oldBlock = text.slice(start, end);
  if (!oldBlock.includes("runAppleScript(script)") || !oldBlock.includes("WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED") || !oldBlock.includes("return execute browserTab javascript")) {
    throw new Error("SEO_PHASE2_RESULT_TRANSPORT_UNEXPECTED_SOURCE");
  }
  const repaired = text.slice(0, start) + FIXED_RUN + text.slice(end);
  return { source: repaired, changed: true, status: "repaired" };
}
