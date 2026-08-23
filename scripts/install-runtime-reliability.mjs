import fs from "node:fs";

const path="src/v2-turn-engine.js";
let source=fs.readFileSync(path,"utf8");
let changed=false;
const importFrom='import { humanizeResponse } from "./human-response.js";';
const importTo='import { humanizeResponse } from "./human-response.js";\nimport { recordRuntimeFault } from "./runtime-reliability.js";';
if(!source.includes('recordRuntimeFault')){if(!source.includes(importFrom))throw new Error("runtime reliability installer could not find import anchor");source=source.replace(importFrom,importTo);changed=true;}
const from='catch(error){\n    emit({type:"status",stage:"planning_failed",message:"The governed plan could not be created."});\n    return[{ok:false,tool:"tool.router",error:`Tool planning unavailable: ${error instanceof Error?error.message:"unknown error"}`,advisoryFallback:true}];\n  }';
const to='catch(error){\n    const message=error instanceof Error?error.message:"unknown error";\n    console.warn("Georgie planner degraded; falling back to normal response:",message);\n    void recordRuntimeFault(userId,{kind:"tool_planner",error:message,recoverable:true,context:{sessionId}}).catch(()=>{});\n    return[];\n  }';
if(!source.includes(to)){if(!source.includes(from))throw new Error("runtime reliability installer could not find planner failure anchor");source=source.replace(from,to);changed=true;}
if(changed)fs.writeFileSync(path,source);
console.log(`[Georgie] Runtime reliability failover installed: changed=${changed}`);
