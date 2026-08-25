import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function patch(relativePath, transform, verify) {
  const target = path.join(root, relativePath);
  const source = fs.readFileSync(target, "utf8");
  const next = transform(source);
  if (next !== source) fs.writeFileSync(target, next);
  const finalSource = fs.readFileSync(target, "utf8");
  if (!verify(finalSource)) throw new Error(`V24_CERT_REPAIR_VERIFICATION_FAILED:${relativePath}`);
}

patch("src/capability-manifest.js", source => {
  if (source.includes('unifiedOperatingRuntime: "unified-georgie-runtime.v2-control-plane"')) return source;
  if (!source.includes('unifiedOperatingRuntime: "unified-georgie-runtime.v1"')) throw new Error("V24_RUNTIME_MANIFEST_ANCHOR_NOT_FOUND");
  return source.replace('unifiedOperatingRuntime: "unified-georgie-runtime.v1"', 'unifiedOperatingRuntime: "unified-georgie-runtime.v2-control-plane"');
}, source => source.includes('unifiedOperatingRuntime: "unified-georgie-runtime.v2-control-plane"'));

patch("src/mac/queue.js", source => {
  const legacy = 'function mergeStores(localStore,cloudStore){const byId=new Map();for(const job of [...(cloudStore?.jobs||[]),...(localStore?.jobs||[])])if(job?.id)byId.set(job.id,job);return{jobs:[...byId.values()].sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))).slice(-5000)}}';
  if (source.includes("function macJobLifecycleMs(job)")) return source;
  if (!source.includes(legacy)) throw new Error("V24_MAC_MONOTONIC_MERGE_ANCHOR_NOT_FOUND");
  const upgraded = `function macJobLifecycleMs(job){\n  const timestamps=[job?.createdAt,job?.availableAt,job?.claimedAt,job?.dispatchReceipt?.claimedAt,job?.completedAt];\n  if(job?.status==="dead_letter")timestamps.push(job?.alert?.raisedAt);\n  return Math.max(0,...timestamps.map(value=>{const ms=new Date(value||0).getTime();return Number.isFinite(ms)?ms:0}));\n}\nfunction macJobStateRank(job){return ({completed:6,failed:5,dead_letter:5,claimed:4,queued:3}[String(job?.status||"")]||0);}\nfunction fresherMacJob(a,b){\n  const at=macJobLifecycleMs(a),bt=macJobLifecycleMs(b);\n  if(at!==bt)return at>bt?a:b;\n  const aa=Number(a?.attempts||0),ba=Number(b?.attempts||0);\n  if(aa!==ba)return aa>ba?a:b;\n  const ar=macJobStateRank(a),br=macJobStateRank(b);\n  if(ar!==br)return ar>br?a:b;\n  return b||a;\n}\nfunction mergeStores(localStore,cloudStore){\n  const byId=new Map();\n  for(const job of [...(cloudStore?.jobs||[]),...(localStore?.jobs||[])]){\n    if(!job?.id)continue;\n    const prior=byId.get(job.id);\n    byId.set(job.id,prior?fresherMacJob(prior,job):job);\n  }\n  return{jobs:[...byId.values()].sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))).slice(-5000)};\n}`;
  return source.replace(legacy, upgraded);
}, source => source.includes("function macJobLifecycleMs(job)") && source.includes("function fresherMacJob(a,b)") && source.includes("prior?fresherMacJob(prior,job):job"));

patch("src/mac/queue.js", source => {
  if (source.includes("function macClaimScore(job, nowMs)")) return source;
  const helper = `function macClaimScore(job, nowMs){\n  const action=String(job?.action||"");\n  const risk=String(job?.risk||"");\n  const availableMs=new Date(job?.availableAt||job?.createdAt||0).getTime();\n  const ageMs=Number.isFinite(availableMs)?Math.max(0,Number(nowMs)-availableMs):0;\n  const base=action==="developer.repo_inspect"?0:action==="developer.file_read"?5000:risk==="read"?10000:20000;\n  return base-Math.min(ageMs,30000);\n}\n`;
  const versionedFunction = "export async function claimMacJobs(deviceId,limit=5,{agentVersion=null}={})";
  const legacyFunction = "export async function claimMacJobs(deviceId,limit=5)";
  const versionedJobs = 'const now=new Date(),jobs=store.jobs.filter(j=>(j.deviceId===deviceId||j.deviceId==="primary-mac")&&j.status==="queued"&&new Date(j.availableAt||j.createdAt)<=now&&agentVersionEligible(j,agentVersion)).slice(0,limit);';
  const legacyJobs = 'const now=new Date(),jobs=store.jobs.filter(j=>(j.deviceId===deviceId||j.deviceId==="primary-mac")&&j.status==="queued"&&new Date(j.availableAt||j.createdAt)<=now).slice(0,limit);';
  const activeJobs = source.includes(versionedFunction) ? versionedJobs : legacyJobs;
  if (!source.includes(activeJobs)) throw new Error("V24_MAC_CLAIM_ANCHOR_NOT_FOUND");
  const insertionAnchor = source.includes("export function agentVersionEligible") ? "export function agentVersionEligible" : (source.includes(versionedFunction) ? versionedFunction : legacyFunction);
  source = source.replace(insertionAnchor, helper + insertionAnchor);
  return source.replace(activeJobs, activeJobs.replace("const now=new Date(),jobs=", "const now=new Date(),nowMs=now.getTime(),jobs=").replace(".slice(0,limit);", '.sort((a,b)=>macClaimScore(a,nowMs)-macClaimScore(b,nowMs)||String(a.createdAt||"").localeCompare(String(b.createdAt||""))).slice(0,limit);'));
}, source => source.includes("function macClaimScore(job, nowMs)") && source.includes("developer.repo_inspect") && source.includes(".sort((a,b)=>macClaimScore(a,nowMs)-macClaimScore(b,nowMs)"));

patch("src/mac/queue.js", source => {
  const start = source.indexOf("export async function enqueueMacJob(");
  const end = source.indexOf("\nexport async function importRecoveredMacJob", start);
  if (start < 0 || end < 0) throw new Error("V24_MAC_ENQUEUE_FUNCTION_NOT_FOUND");
  const block = source.slice(start, end);
  if (block.includes("},{durableClaimBoundary:true});")) return source;
  const oldTail = '    store.jobs.push(job);store.jobs=store.jobs.slice(-5000);return job;\n  });\n}';
  const newTail = '    store.jobs.push(job);store.jobs=store.jobs.slice(-5000);return job;\n  },{durableClaimBoundary:true});\n}';
  if (!block.includes(oldTail)) throw new Error("V24_MAC_ENQUEUE_DURABILITY_ANCHOR_NOT_FOUND");
  const nextBlock = block.replace(oldTail, newTail);
  return source.slice(0, start) + nextBlock + source.slice(end);
}, source => {
  const start = source.indexOf("export async function enqueueMacJob(");
  const end = source.indexOf("\nexport async function importRecoveredMacJob", start);
  return start >= 0 && end > start && source.slice(start, end).includes("},{durableClaimBoundary:true});");
});

console.log("[Georgie] v2.4 certification repairs installed");
