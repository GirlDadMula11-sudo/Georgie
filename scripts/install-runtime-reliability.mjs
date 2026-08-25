import fs from "node:fs";
import "./install-smartlead-reply-backpressure.mjs";
import "./install-cloud-state-pressure.mjs";

const path="src/v2-turn-engine.js";
let source=fs.readFileSync(path,"utf8");
let changed=false;
const importFrom='import { investmentDirectResponse } from "./investment-intelligence.js";';
const importTo='import { investmentDirectResponse } from "./investment-intelligence.js";\nimport { recordRuntimeFault } from "./runtime-reliability.js";';
if(!source.includes('import { recordRuntimeFault } from "./runtime-reliability.js";')){if(!source.includes(importFrom))throw new Error("runtime reliability installer could not find import anchor");source=source.replace(importFrom,importTo);changed=true;}
const from='catch(error){\n    emit({type:"status",stage:"planning_failed",message:"The governed plan could not be created."});\n    return[{ok:false,tool:"tool.router",error:`Tool planning unavailable: ${error instanceof Error?error.message:"unknown error"}`,advisoryFallback:true}];\n  }';
const to='catch(error){\n    const message=error instanceof Error?error.message:"unknown error";\n    console.warn("Georgie planner degraded; falling back to normal response:",message);\n    void recordRuntimeFault(userId,{kind:"tool_planner",error:message,recoverable:true,context:{sessionId}}).catch(()=>{});\n    return[];\n  }';
if(!source.includes(to)){if(!source.includes(from))throw new Error("runtime reliability installer could not find planner failure anchor");source=source.replace(from,to);changed=true;}
if(changed)fs.writeFileSync(path,source);
console.log(`[Georgie] Runtime reliability failover installed: changed=${changed}`);
