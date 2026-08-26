import fs from "node:fs";
import { applyWordpressResultTransportRepair } from "./wordpress-result-transport-repair-lib.mjs";

const target = "mac-agent/agent.js";
const before = fs.readFileSync(target, "utf8");
const result = applyWordpressResultTransportRepair(before);
if (result.changed) fs.writeFileSync(target, result.source);
console.log(`WordPress result transport repair: ${result.status}`);
