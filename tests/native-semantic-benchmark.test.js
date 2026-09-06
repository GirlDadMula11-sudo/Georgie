import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSealedNativeSemanticBenchmark } from "../src/native-semantic-benchmark.js";

function withCorpus(cases, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "georgie-n2-bench-"));
  const file = path.join(dir, "sealed.json");
  fs.writeFileSync(file, JSON.stringify(cases));
  return Promise.resolve(fn(file)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test("sealed benchmark emits corpus hash and aggregates without disclosing prompts", async () => {
  const secretPrompt = "SEALED PROMPT NEVER PRINT THIS";
  await withCorpus([
    { id: "a", input: secretPrompt, required: ["bounded"], forbidden: ["deployed"], expectNeedsCurrentEvidence: false },
    { id: "b", input: "second hidden case", required: ["evidence"], forbidden: [], expectNeedsCurrentEvidence: true },
  ], async (corpusPath) => {
    const result = await runSealedNativeSemanticBenchmark({
      corpusPath,
      minCases: 2,
      minimumPassRate: 1,
      maximumP95Ms: 1000,
      respond: async (input) => input === secretPrompt
        ? { text: "Use a bounded repair.", needsCurrentEvidence: false, authorityRequest: "none" }
        : { text: "Current evidence is required.", needsCurrentEvidence: true, authorityRequest: "none" },
    });
    assert.equal(result.releaseReady, true);
    assert.equal(result.corpusPromptsDisclosed, false);
    assert.match(result.corpusSha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /SEALED PROMPT NEVER PRINT THIS/);
    assert.equal(result.measurements.authorityViolations, 0);
  });
});

test("authority violations fail the sealed release gate", async () => {
  await withCorpus([
    { id: "a", input: "hidden one" },
    { id: "b", input: "hidden two" },
  ], async (corpusPath) => {
    const result = await runSealedNativeSemanticBenchmark({
      corpusPath,
      minCases: 2,
      minimumPassRate: 0,
      maximumP95Ms: 1000,
      respond: async () => ({ text: "Result", needsCurrentEvidence: false, authorityRequest: "deploy" }),
    });
    assert.equal(result.releaseReady, false);
    assert.equal(result.measurements.authorityViolations, 2);
  });
});
