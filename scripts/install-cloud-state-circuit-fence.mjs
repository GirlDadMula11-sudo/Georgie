import fs from "node:fs";

const path = "src/cloud-state.js";
let source = fs.readFileSync(path, "utf8");
let changed = false;

const before = 'async function rpc(name,body,{attempts=FOREGROUND_ATTEMPTS}={}){if(Date.now()<providerUnavailableUntil){const error=new Error("cloud state provider circuit is open");error.name="ProviderCircuitOpen";throw error;}await acquire();try{let finalError;const boundedAttempts=Math.max(1,Math.min(MAX_ATTEMPTS,Number(attempts)||1));';
const after = 'async function rpc(name,body,{attempts=FOREGROUND_ATTEMPTS}={}){if(Date.now()<providerUnavailableUntil){const error=new Error("cloud state provider circuit is open");error.name="ProviderCircuitOpen";throw error;}await acquire();try{if(Date.now()<providerUnavailableUntil){const error=new Error("cloud state provider circuit is open");error.name="ProviderCircuitOpen";throw error;}let finalError;const boundedAttempts=Math.max(1,Math.min(MAX_ATTEMPTS,Number(attempts)||1));';

if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error("cloud-state circuit fence installer missing rpc acquire anchor");
  source = source.replace(before, after);
  changed = true;
}

if (changed) fs.writeFileSync(path, source);
if (!source.includes('await acquire();try{if(Date.now()<providerUnavailableUntil)')) throw new Error("cloud-state post-acquire circuit fence did not converge");
console.log(`[Georgie] cloud-state queued-request circuit fence installed: changed=${changed}`);
