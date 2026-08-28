import { evaluateMarketReadiness } from "../src/market-readiness.js";

const origin=String(process.env.GEORGIE_PUBLIC_ORIGIN||process.argv[2]||"https://georgie-kappa.vercel.app").replace(/\/$/,"");

async function request(path,{json=false}={}){
  const started=Date.now();
  const response=await fetch(`${origin}${path}`,{redirect:"follow",headers:{accept:json?"application/json":"*/*"},signal:AbortSignal.timeout(8_000)});
  const raw=await response.text();
  let body=raw;
  if(json){try{body=JSON.parse(raw);}catch{body={parseError:true,raw:raw.slice(0,200)};}}
  return{status:response.status,body,headers:Object.fromEntries(response.headers),ms:Date.now()-started};
}

try{
  const [home,manifest,health,readiness,unauthorized]=await Promise.all([
    request("/"),request("/manifest.webmanifest",{json:true}),request("/health",{json:true}),request("/api/readiness",{json:true}),request("/api/mobile/device",{json:true})
  ]);
  const report=evaluateMarketReadiness({home,manifest,health,readiness,unauthorized,timings:{home:home.ms,manifest:manifest.ms,health:health.ms,readiness:readiness.ms,deviceAuth:unauthorized.ms}});
  console.log(JSON.stringify({origin,...report},null,2));
  if(!report.ready)process.exitCode=1;
}catch(error){
  console.error(JSON.stringify({origin,ready:false,blockers:["market_readiness_check_failed"],error:error instanceof Error?error.message:String(error)},null,2));
  process.exitCode=1;
}
