import "dotenv/config";
import { runReliabilityHarness } from "../src/reliability-harness.js";

const runs=Math.max(1,Number(process.env.GEORGIE_RELIABILITY_HARNESS_RUNS||2));
const maxLatencyMs=Math.max(1000,Number(process.env.GEORGIE_RELIABILITY_MAX_LATENCY_MS||15000));
const result=await runReliabilityHarness({runs,maxLatencyMs});
console.log(`[Georgie] Reliability harness result: ${JSON.stringify(result)}`);
if(!result.certification?.certified)process.exitCode=2;
