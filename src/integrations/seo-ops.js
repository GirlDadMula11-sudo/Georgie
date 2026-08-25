import crypto from "node:crypto";
import { readCloudState, writeCloudState } from "../cloud-state.js";

const SIERRA_URL = String(process.env.GEORGIE_SUPABASE_URL || "").replace(/\/$/, "");
const SIERRA_KEY = String(process.env.GEORGIE_SUPABASE_SERVICE_ROLE_KEY || "");
const GSC_SITE = String(process.env.GEORGIE_GSC_SITE_URL || "").trim();
const GA4_PROPERTY = String(process.env.GEORGIE_GA4_PROPERTY_ID || "").trim();
const GOOGLE_EMAIL = String(process.env.GEORGIE_GOOGLE_CLIENT_EMAIL || "").trim();
const GOOGLE_PRIVATE_KEY = String(process.env.GEORGIE_GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
const PAGESPEED_KEY = String(process.env.GEORGIE_PAGESPEED_API_KEY || "").trim();
const INDEXNOW_KEY = String(process.env.GEORGIE_INDEXNOW_KEY || "").trim();
const WEBSITE_ROOT = String(process.env.GEORGIE_WEBSITE_ROOT_URL || "https://www.sierramarketinginc.com").replace(/\/$/, "");
const WEBSITE_REPOSITORY = String(process.env.GEORGIE_WEBSITE_REPOSITORY || "").trim();
const SYNTHETIC_LANDING = String(process.env.GEORGIE_SYNTHETIC_LANDING_URL || "").trim();
const SYNTHETIC_INTAKE = String(process.env.GEORGIE_SYNTHETIC_INTAKE_URL || "").trim();
const LEDGER_NS = "seo_evidence_ledger_v1";
let googleTokenCache = null;

const now = () => new Date().toISOString();
const clean = (v, max=2000) => String(v ?? "").trim().slice(0,max);
const sha = v => crypto.createHash("sha256").update(String(v)).digest("hex");
const b64url = value => Buffer.from(value).toString("base64url");
export function sameWebsiteHost(a,b) { try { const normalize = value => new URL(value).hostname.toLowerCase().replace(/^www\./, ""); return normalize(a) === normalize(b); } catch { return false; } }
const sameHost = sameWebsiteHost;

async function sierraRpc(name, body={}) {
  if (!SIERRA_URL || !SIERRA_KEY) throw new Error("Sierra SEO RPC connection is not configured");
  const r = await fetch(`${SIERRA_URL}/rest/v1/rpc/${name}`, { method:"POST", headers:{"content-type":"application/json",apikey:SIERRA_KEY,authorization:`Bearer ${SIERRA_KEY}`}, body:JSON.stringify(body), signal:AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${name} failed (${r.status}): ${(await r.text().catch(()=>"" )).slice(0,300)}`);
  return r.json();
}

async function googleAccessToken() {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now()+60_000) return googleTokenCache.token;
  if (!GOOGLE_EMAIL || !GOOGLE_PRIVATE_KEY) throw new Error("Google service account is not configured for Georgie");
  const issued = Math.floor(Date.now()/1000), header = {alg:"RS256",typ:"JWT"};
  const payload = { iss:GOOGLE_EMAIL, scope:"https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/analytics.readonly", aud:"https://oauth2.googleapis.com/token", iat:issued, exp:issued+3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), GOOGLE_PRIVATE_KEY).toString("base64url");
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method:"POST", headers:{"content-type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}), signal:AbortSignal.timeout(10000) });
  const data = await response.json().catch(()=>({}));
  if (!response.ok || !data.access_token) throw new Error(`Google OAuth failed (${response.status})`);
  googleTokenCache = { token:data.access_token, expiresAt:Date.now()+(Number(data.expires_in||3600)*1000) };
  return googleTokenCache.token;
}

async function googleJson(url, {method="GET",body}={}) {
  const token = await googleAccessToken();
  const r = await fetch(url,{method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`Google API failed (${r.status}): ${clean(data?.error?.message||"provider_error",300)}`);
  return data;
}

export function seoIntegrationStatus() {
  return {
    websiteRoot: WEBSITE_ROOT,
    websiteRepository: WEBSITE_REPOSITORY || null,
    googleSearchConsoleConfigured: Boolean(GSC_SITE && GOOGLE_EMAIL && GOOGLE_PRIVATE_KEY),
    ga4Configured: Boolean(GA4_PROPERTY && GOOGLE_EMAIL && GOOGLE_PRIVATE_KEY),
    pageSpeedConfigured: true,
    indexNowConfigured: Boolean(INDEXNOW_KEY),
    sierraAttributionConfigured: Boolean(SIERRA_URL && SIERRA_KEY),
    syntheticConversionConfigured: Boolean(SYNTHETIC_LANDING && SYNTHETIC_INTAKE),
    durableEvidenceLedger: true
  };
}

export async function searchConsolePerformance({startDate,endDate,dimensions=["query","page"],rowLimit=1000,dimensionFilterGroups=[]}={}) {
  if(!GSC_SITE) throw new Error("GEORGIE_GSC_SITE_URL is not configured");
  const end = endDate || new Date().toISOString().slice(0,10);
  const start = startDate || new Date(Date.now()-28*86400000).toISOString().slice(0,10);
  const body={startDate:start,endDate:end,dimensions:dimensions.slice(0,5),rowLimit:Math.max(1,Math.min(Number(rowLimit)||1000,25000)),dimensionFilterGroups};
  const data=await googleJson(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`,{method:"POST",body});
  return {site:GSC_SITE,startDate:start,endDate:end,rows:(data.rows||[]).map(r=>({keys:r.keys||[],clicks:r.clicks||0,impressions:r.impressions||0,ctr:r.ctr||0,position:r.position||0}))};
}

export async function inspectSearchConsoleUrl(url) {
  if(!GSC_SITE) throw new Error("GEORGIE_GSC_SITE_URL is not configured");
  if(!sameHost(url,WEBSITE_ROOT)) throw new Error("URL inspection is restricted to Sierra website host");
  const data=await googleJson("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",{method:"POST",body:{inspectionUrl:url,siteUrl:GSC_SITE,languageCode:"en-US"}});
  const r=data.inspectionResult||{};
  return {url,indexStatus:r.indexStatusResult||null,mobileUsability:r.mobileUsabilityResult||null,richResults:r.richResultsResult||null};
}

export async function submitSitemap(sitemapUrl=`${WEBSITE_ROOT}/sitemap.xml`) {
  if(!GSC_SITE) throw new Error("GEORGIE_GSC_SITE_URL is not configured");
  if(!sameHost(sitemapUrl,WEBSITE_ROOT)) throw new Error("Sitemap must be on Sierra website host");
  await googleJson(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,{method:"PUT"});
  return {submitted:true,site:GSC_SITE,sitemapUrl};
}

export async function ga4Report({startDate="28daysAgo",endDate="today",dimensions=["landingPagePlusQueryString"],metrics=["sessions","engagedSessions","keyEvents"],limit=1000,dimensionFilter}={}) {
  if(!GA4_PROPERTY) throw new Error("GEORGIE_GA4_PROPERTY_ID is not configured");
  const body={dateRanges:[{startDate,endDate}],dimensions:dimensions.slice(0,8).map(name=>({name})),metrics:metrics.slice(0,10).map(name=>({name})),limit:String(Math.max(1,Math.min(Number(limit)||1000,100000)))};
  if(dimensionFilter) body.dimensionFilter=dimensionFilter;
  const data=await googleJson(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(GA4_PROPERTY)}:runReport`,{method:"POST",body});
  return {propertyId:GA4_PROPERTY,dimensionHeaders:data.dimensionHeaders||[],metricHeaders:data.metricHeaders||[],rows:data.rows||[],rowCount:data.rowCount||0};
}

async function fetchRedirectChain(url,max=8){
  const chain=[];let current=url;
  for(let i=0;i<max;i++){
    const r=await fetch(current,{redirect:"manual",headers:{"user-agent":"Georgie-SEO-Crawler/1.0"},signal:AbortSignal.timeout(12000)});
    chain.push({url:current,status:r.status,location:r.headers.get("location")});
    if(r.status<300||r.status>=400||!r.headers.get("location")) return {chain,response:r,finalUrl:current};
    current=new URL(r.headers.get("location"),current).href;
  }
  return {chain,response:null,finalUrl:current};
}
function tagContent(html,tag){const m=String(html).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,`i`));return m?m[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():null;}
function metaContent(html,name){const rx=new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`,`i`);const alt=new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`,`i`);return (String(html).match(rx)||String(html).match(alt)||[])[1]||null;}
function linkRel(html,rel){const rx=new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>`,`i`);const alt=new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*${rel}[^"']*["'][^>]*>`,`i`);return (String(html).match(rx)||String(html).match(alt)||[])[1]||null;}
function extractLinks(html,base){const out=[];for(const m of String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)){try{const u=new URL(m[1],base);if(["http:","https:"].includes(u.protocol))out.push(u.href.split("#")[0]);}catch{}}return [...new Set(out)];}

export async function crawlWebsite({startUrl=WEBSITE_ROOT,maxPages=150}={}) {
  if(!sameHost(startUrl,WEBSITE_ROOT)) throw new Error("Crawler start URL must be on Sierra website host");
  const max=Math.max(1,Math.min(Number(maxPages)||150,500)),queue=[startUrl],seen=new Set(),pages=[];
  while(queue.length&&pages.length<max){const url=queue.shift();if(seen.has(url)||!sameHost(url,WEBSITE_ROOT))continue;seen.add(url);
    try{const {chain,response,finalUrl}=await fetchRedirectChain(url);if(!response){pages.push({url,status:null,redirectChain:chain,error:"redirect_limit"});continue;}const type=response.headers.get("content-type")||"";const html=type.includes("text/html")?await response.text():"";const links=html?extractLinks(html,finalUrl):[];for(const l of links)if(!seen.has(l)&&sameHost(l,WEBSITE_ROOT))queue.push(l);
      pages.push({url,finalUrl,status:response.status,redirectChain:chain,title:html?tagContent(html,"title"):null,description:html?metaContent(html,"description"):null,canonical:html?linkRel(html,"canonical"):null,robots:html?metaContent(html,"robots"):null,h1:html?tagContent(html,"h1"):null,h1Count:html?(html.match(/<h1\b/gi)||[]).length:0,h2Count:html?(html.match(/<h2\b/gi)||[]).length:0,structuredDataBlocks:html?(html.match(/<script[^>]+type=["']application\/ld\+json["']/gi)||[]).length:0,internalLinks:links.filter(l=>sameHost(l,WEBSITE_ROOT)).length});
    }catch(e){pages.push({url,status:null,error:clean(e instanceof Error?e.message:e,300)});}
  }
  const broken=pages.filter(p=>p.status>=400),redirects=pages.filter(p=>p.redirectChain?.length>1),missingTitles=pages.filter(p=>p.status===200&&!p.title),missingDescriptions=pages.filter(p=>p.status===200&&!p.description),noCanonical=pages.filter(p=>p.status===200&&!p.canonical);
  return {root:WEBSITE_ROOT,crawledAt:now(),pageCount:pages.length,summary:{broken:broken.length,redirects:redirects.length,missingTitles:missingTitles.length,missingDescriptions:missingDescriptions.length,noCanonical:noCanonical.length},pages};
}

export async function pageSpeed(url,{strategy="mobile"}={}) {
  if(!sameHost(url,WEBSITE_ROOT)) throw new Error("PageSpeed is restricted to Sierra website host");
  const qs=new URLSearchParams({url,strategy:strategy==="desktop"?"desktop":"mobile",category:"performance",category:"seo",category:"accessibility",category:"best-practices"});if(PAGESPEED_KEY)qs.set("key",PAGESPEED_KEY);
  const r=await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`,{signal:AbortSignal.timeout(30000)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`PageSpeed failed (${r.status})`);
  const cats=d.lighthouseResult?.categories||{},audits=d.lighthouseResult?.audits||{};
  return {url,strategy,scores:Object.fromEntries(Object.entries(cats).map(([k,v])=>[k,v.score])),coreWebVitals:{lcp:audits["largest-contentful-paint"]?.numericValue??null,cls:audits["cumulative-layout-shift"]?.numericValue??null,tbt:audits["total-blocking-time"]?.numericValue??null,inp:audits["interaction-to-next-paint"]?.numericValue??null},analysisUTCTimestamp:d.analysisUTCTimestamp||null};
}

export async function submitIndexNow(urls=[]) {
  if(!INDEXNOW_KEY) throw new Error("GEORGIE_INDEXNOW_KEY is not configured");
  const list=[...new Set(urls.map(String).filter(u=>sameHost(u,WEBSITE_ROOT)))].slice(0,10000);if(!list.length)throw new Error("At least one Sierra website URL is required");
  const host=new URL(WEBSITE_ROOT).host;const r=await fetch("https://api.indexnow.org/indexnow",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({host,key:INDEXNOW_KEY,keyLocation:`${WEBSITE_ROOT}/${INDEXNOW_KEY}.txt`,urlList:list}),signal:AbortSignal.timeout(15000)});
  if(![200,202].includes(r.status))throw new Error(`IndexNow failed (${r.status})`);return {submitted:true,count:list.length,status:r.status};
}

export async function recordOrganicAttribution(args={}) { return sierraRpc("georgie_record_organic_attribution",{p_idempotency_key:args.idempotencyKey,p_event_type:args.eventType,p_tracking_code:args.trackingCode||null,p_referral_id:args.referralId||null,p_page_url:args.pageUrl||null,p_search_query:args.searchQuery||null,p_experiment_key:args.experimentKey||null,p_test_mode:Boolean(args.testMode),p_attributed_revenue:args.attributedRevenue??null,p_metadata:args.metadata||{},p_event_at:args.eventAt||now()}); }
export async function getApplicationFunnel({days=30}={}) { return sierraRpc("georgie_get_application_funnel",{p_days:days}); }
export async function recordSeoExperiment(args={}) { return sierraRpc("georgie_record_seo_experiment",{p_experiment_key:args.experimentKey,p_page_url:args.pageUrl,p_hypothesis:args.hypothesis||null,p_variant:args.variant||null,p_status:args.status||"planned",p_metadata:args.metadata||{}}); }
export async function readFundedOutcome({days=365}={}) { return sierraRpc("georgie_read_funded_outcome",{p_days:days}); }

export async function recordSeoEvidence(userId,input={}) {
  const store=await readCloudState(String(userId||"primary"),LEDGER_NS,{version:1,entries:[]});const entry={id:crypto.randomUUID(),at:now(),action:clean(input.action,160),target:clean(input.target,1000),before:sanitizeLedger(input.before),after:sanitizeLedger(input.after),commit:clean(input.commit,120)||null,deployment:clean(input.deployment,160)||null,testResult:sanitizeLedger(input.testResult),metricBefore:sanitizeLedger(input.metricBefore),metricAfter:sanitizeLedger(input.metricAfter),rollback:clean(input.rollback,1500)||null,evidenceRefs:(input.evidenceRefs||[]).map(v=>clean(v,300)).slice(0,30)};
  const next={version:1,entries:[...(Array.isArray(store.entries)?store.entries:[]),entry].slice(-5000),updatedAt:now()};await writeCloudState(String(userId||"primary"),LEDGER_NS,next);return entry;
}
function sanitizeLedger(v,depth=0){if(depth>4)return"[bounded]";if(Array.isArray(v))return v.slice(0,30).map(x=>sanitizeLedger(x,depth+1));if(v&&typeof v==="object"){const o={};for(const[k,x]of Object.entries(v).slice(0,60))o[k]=/(password|secret|token|cookie|authorization|credential|email|phone|ssn|ein)/i.test(k)?"[redacted]":sanitizeLedger(x,depth+1);return o;}return typeof v==="string"?v.slice(0,1500):v;}
export async function listSeoEvidence(userId,{limit=100}={}){const s=await readCloudState(String(userId||"primary"),LEDGER_NS,{version:1,entries:[]});return (s.entries||[]).slice(-Math.max(1,Math.min(Number(limit)||100,500))).reverse();}

export async function syntheticConversionTest({landingUrl=SYNTHETIC_LANDING,intakeUrl=SYNTHETIC_INTAKE}={}) {
  if(!landingUrl||!intakeUrl)throw new Error("Synthetic conversion endpoints are not configured");if(!sameHost(landingUrl,WEBSITE_ROOT))throw new Error("Synthetic landing URL must be on Sierra website host");
  const trace=`synthetic-${crypto.randomUUID()}`;const landing=await fetch(landingUrl,{headers:{"user-agent":"Georgie-Synthetic-Conversion/1.0","x-georgie-test":"true"},signal:AbortSignal.timeout(15000)});if(!landing.ok)throw new Error(`Synthetic landing failed (${landing.status})`);
  const intake=await fetch(intakeUrl,{method:"POST",headers:{"content-type":"application/json","x-georgie-test":"true"},body:JSON.stringify({test_mode:true,synthetic:true,source:"georgie_synthetic",trace_id:trace}),signal:AbortSignal.timeout(15000)});const data=await intake.json().catch(()=>({}));if(!intake.ok)throw new Error(`Synthetic intake failed (${intake.status})`);
  const acknowledged=data.test_mode===true||data.synthetic===true||data.test===true;if(!acknowledged)throw new Error("Synthetic intake did not confirm permanent test isolation; refusing certification");return {ok:true,traceId:trace,landingStatus:landing.status,intakeStatus:intake.status,testIsolationConfirmed:true};
}

export function websiteControlStatus(){return{root:WEBSITE_ROOT,repository:WEBSITE_REPOSITORY||null,repositoryBacked:Boolean(WEBSITE_REPOSITORY),requiredGitHubAllowlist:WEBSITE_REPOSITORY||null,editableSurfaces:["titles","metadata","content","schema","internal_links","navigation","ctas","redirects","sitemaps"]};}
