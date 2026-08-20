import fs from 'fs';

const file = new URL('../src/server.js', import.meta.url);
let source = fs.readFileSync(file, 'utf8');
let changed = false;

const marker = 'speech=await synthesizeSpeech(response';
if (source.includes(marker)) {
  const prefix = source.slice(0, source.indexOf(marker));
  const repairedTail = `speech=await synthesizeSpeech(response.text);res.json({ok:true,transcript,text:response.text,response,speechBase64:speech.toString("base64"),contentType:"audio/mpeg"})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Unknown error"})}});\n\nstartProactiveEngine();\nstartEmailIntelligence();\nconst PORT=Number(process.env.PORT||10000);\napp.listen(PORT,()=>console.log(\`Georgie listening on port \${PORT}\`));\n`;
  source = prefix + repairedTail;
  changed = true;
  console.log('[Georgie] Repaired truncated server.js tail.');
} else {
  console.log('[Georgie] server.js tail already intact; no repair needed.');
}

const v2Import = 'import { completeTurnV2 } from "./v2-turn-engine.js";';
if (!source.includes(v2Import)) {
  const anchor = 'import { createSierraRouter } from "./sierra-router.js";';
  if (!source.includes(anchor)) throw new Error('Unable to locate Georgie server import anchor for v2 engine');
  source = source.replace(anchor, `${anchor}\n${v2Import}`);
  changed = true;
}

if (!source.includes('engine:"v2-concurrent"')) {
  const start = source.indexOf('async function completeTurn({userId,sessionId,input,history=[]}){');
  const end = source.indexOf('app.get("/health"', start);
  if (start === -1 || end === -1) throw new Error('Unable to locate Georgie completeTurn for v2 activation');
  const replacement = `async function completeTurn({userId,sessionId,input,history=[]}){\n  const fast=await tryFastMacTurn(userId,input);\n  if(fast){\n    Promise.all([\n      appendSessionTurn({userId,sessionId,role:"user",content:input}),\n      appendSessionTurn({userId,sessionId,role:"assistant",content:fast.text})\n    ]).catch(error=>console.warn("Fast-turn persistence delayed:",error instanceof Error?error.message:error));\n    return{...fast,responseId:null,remembered:0,memoryCount:0,webSearches:0,model:"deterministic-mac-router",engine:"v2-fast",latencyMs:0};\n  }\n  return completeTurnV2({userId,sessionId,input,history});\n}\n`;
  source = source.slice(0, start) + replacement + source.slice(end);
  changed = true;
  console.log('[Georgie] Activated v2 concurrent turn engine.');
}

if (changed) fs.writeFileSync(file, source);

try {
  const { sierraWorkforceConfigured, getSierraHealth } = await import('../src/integrations/sierra-workforce.js');
  const configured = sierraWorkforceConfigured();
  console.log(`[Georgie] Sierra Workforce configured: ${configured}`);
  if (configured) {
    const payload = await getSierraHealth('startup-diagnostic');
    const first = Array.isArray(payload) ? payload[0] : payload;
    const health = first?.health || first || {};
    const metrics = health?.metrics || {};
    console.log('[Georgie] Sierra Workforce diagnostic:', JSON.stringify({
      health_status: health?.health_status || 'unknown',
      active_deals: metrics?.active_deals ?? null,
      failed_pipeline_stages: metrics?.failed_pipeline_stages ?? null,
      failed_lender_deliveries: metrics?.failed_lender_deliveries ?? null,
      stale_running_stages: metrics?.stale_running_stages ?? null,
      guarded_lender_activity_evidence_conflicts: metrics?.guarded_lender_activity_evidence_conflicts ?? null
    }));
  }
} catch (error) {
  console.warn('[Georgie] Sierra Workforce startup diagnostic failed:', error instanceof Error ? error.message : error);
}
