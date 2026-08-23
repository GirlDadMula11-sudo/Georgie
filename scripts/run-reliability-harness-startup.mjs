import "dotenv/config";
import { assertReliabilityBaseline } from "../src/reliability-baseline.js";

if(process.env.GEORGIE_RUN_RELIABILITY_HARNESS_ON_START!=="true"){
  console.log("[Georgie] Reliability harness startup hook skipped.");
  process.exit(0);
}

try{
  const { runReliabilityHarness } = await import("../src/reliability-harness.js");
  const runs=Math.max(1,Number(process.env.GEORGIE_RELIABILITY_HARNESS_RUNS||2));
  const maxLatencyMs=Math.max(1000,Number(process.env.GEORGIE_RELIABILITY_MAX_LATENCY_MS||15000));
  const result=await runReliabilityHarness({runs,maxLatencyMs});
  console.log(`[Georgie] Reliability harness result: ${JSON.stringify(result)}`);
  assertReliabilityBaseline(result);
  console.log("[Georgie] Reliability baseline gate passed.");
}catch(error){
  console.error(`[Georgie] Reliability harness startup failure: ${error instanceof Error?error.stack||error.message:String(error)}`);
  process.exitCode=1;
}
