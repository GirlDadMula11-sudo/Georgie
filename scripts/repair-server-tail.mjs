import fs from 'fs';

const file = new URL('../src/server.js', import.meta.url);
let source = fs.readFileSync(file, 'utf8');
const marker = 'speech=await synthesizeSpeech(response';

if (!source.includes(marker)) {
  console.log('[Georgie] server.js tail already intact; no repair needed.');
  process.exit(0);
}

const prefix = source.slice(0, source.indexOf(marker));
const repairedTail = `speech=await synthesizeSpeech(response.text);res.json({ok:true,transcript,text:response.text,response,speechBase64:speech.toString("base64"),contentType:"audio/mpeg"})}catch(error){res.status(500).json({ok:false,error:error instanceof Error?error.message:"Unknown error"})}});\n\nstartProactiveEngine();\nstartEmailIntelligence();\nconst PORT=Number(process.env.PORT||10000);\napp.listen(PORT,()=>console.log(\`Georgie listening on port \${PORT}\`));\n`;

source = prefix + repairedTail;
fs.writeFileSync(file, source);
console.log('[Georgie] Repaired truncated server.js tail.');
