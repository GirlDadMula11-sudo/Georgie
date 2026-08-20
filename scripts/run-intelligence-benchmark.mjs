import { runStaticBenchmark } from "../src/intelligence-benchmark.js";
const result = runStaticBenchmark();
console.log(JSON.stringify(result, null, 2));
if (result.failed.length) process.exitCode = 1;
