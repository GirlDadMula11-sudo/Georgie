import { runSealedNativeSemanticBenchmark } from "../src/native-semantic-benchmark.js";

try {
  const result = await runSealedNativeSemanticBenchmark();
  console.log(JSON.stringify(result, null, 2));
  if (!result.releaseReady) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    schema: "sierra.native-semantic-benchmark.error.v1",
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
}
