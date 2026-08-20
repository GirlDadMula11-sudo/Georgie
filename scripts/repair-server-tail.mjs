import fs from 'fs';

const file = new URL('../src/server.js', import.meta.url);
let source = fs.readFileSync(file, 'utf8');
const marker = 'speech=await synthesizeSpeech(response';

if (source.includes(marker)) {
  const prefix = source.slice(0, source.indexOf(marker));
  const repairedTail = `speech=await synthesizeSpeech(response.text);res.json({ok:true,transcript,text:response.text,response,speechBase64:speech.toString("base64"),contentType:"audio/mpeg"})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Unknown error"})}});\n\nstartProactiveEngine();\nstartEmailIntelligence();\nconst PORT=Number(process.env.PORT||10000);\napp.listen(PORT,()=>console.log(\`Georgie listening on port \${PORT}\`));\n`;
  source = prefix + repairedTail;
  fs.writeFileSync(file, source);
  console.log('[Georgie] Repaired truncated server.js tail.');
} else {
  console.log('[Georgie] server.js tail already intact; no repair needed.');
}

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
