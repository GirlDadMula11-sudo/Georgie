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
  if (source.includes("function macClaimScore(job, nowMs)")) return source;
  const anchor = 'export async function claimMacJobs(deviceId,limit=5){await reconcileMacDispatches();const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const now=new Date(),jobs=store.jobs.filter(j=>(j.deviceId===deviceId||j.deviceId==="primary-mac")&&j.status==="queued"&&new Date(j.availableAt||j.createdAt)<=now).slice(0,limit);';
  if (!source.includes(anchor)) throw new Error("V24_MAC_CLAIM_ANCHOR_NOT_FOUND");
  const helper = `function macClaimScore(job, nowMs){\n  const action=String(job?.action||"");\n  const risk=String(job?.risk||"");\n  const availableMs=new Date(job?.availableAt||job?.createdAt||0).getTime();\n  const ageMs=Number.isFinite(availableMs)?Math.max(0,Number(nowMs)-availableMs):0;\n  const base=action==="developer.repo_inspect"?0:action==="developer.file_read"?5000:risk==="read"?10000:20000;\n  return base-Math.min(ageMs,30000);\n}\n`;
  const replacement = `${helper}export async function claimMacJobs(deviceId,limit=5){await reconcileMacDispatches();const uid=safeUserId(PRIMARY());return mutateStore(uid,store=>{const now=new Date(),nowMs=now.getTime(),jobs=store.jobs.filter(j=>(j.deviceId===deviceId||j.deviceId==="primary-mac")&&j.status==="queued"&&new Date(j.availableAt||j.createdAt)<=now).sort((a,b)=>macClaimScore(a,nowMs)-macClaimScore(b,nowMs)||String(a.createdAt||"").localeCompare(String(b.createdAt||""))).slice(0,limit);`;
  return source.replace(anchor, replacement);
}, source => source.includes("function macClaimScore(job, nowMs)") && source.includes("developer.repo_inspect") && source.includes(".sort((a,b)=>macClaimScore(a,nowMs)-macClaimScore(b,nowMs)"));

console.log("[Georgie] v2.4 certification repairs installed");
