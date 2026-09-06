import test from "node:test";
import assert from "node:assert/strict";
import { nativeFirstSemanticResponse, nativeIntelligenceOrchestratorContract } from "../src/native-intelligence-orchestrator.js";

test("complete provider outage cannot terminate a deep native conversation when N2 is healthy", async () => {
  let externalCalls = 0;
  const result = await nativeFirstSemanticResponse(
    "Analyze the architecture tradeoffs deeply and challenge my assumptions.",
    [],
    "verified local context",
    {
      nativeRespond: async () => ({
        text: "The strongest design is to keep authority deterministic and inference replaceable, then promote only measured improvements.",
        model: "sierra-native:test",
        native: true,
        confidence: "high",
        authorityRequest: "none",
        completed: true,
        terminalState: "verified_native_inference",
        route: { provider: "sierra_native", externalInferenceRequired: false },
      }),
      externalEnabled: true,
      shadowExternal: true,
      externalRespond: async () => {
        externalCalls += 1;
        throw new Error("You have no credits remaining");
      },
    },
  );
  assert.equal(result.completed, true);
  assert.equal(result.externalAcceleratorUsed, false);
  assert.equal(result.route.provider, "sierra_native");
  assert.match(result.text, /authority deterministic/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(externalCalls, 1);
});

test("if both semantic engines are unavailable, Georgie degrades natively instead of surfacing provider billing", async () => {
  const result = await nativeFirstSemanticResponse("Explain the architecture tradeoff deeply.", [], "", {
    nativeRespond: async () => { const error = new Error("native server down"); error.code = "native_semantic_transport_failure"; throw error; },
    externalEnabled: true,
    allowExternalRecovery: true,
    externalRespond: async () => { throw new Error("insufficient_quota"); },
  });
  assert.equal(result.completed, true);
  assert.equal(result.terminal, false);
  assert.equal(result.terminalState, "native_bounded_continuation");
  assert.equal(result.nativeFailureCode, "native_semantic_transport_failure");
  assert.doesNotMatch(result.text, /credits|quota|billing|openai/i);
});

test("optional external recovery is never attempted without explicit enable", async () => {
  let externalCalls = 0;
  const result = await nativeFirstSemanticResponse("Analyze this", [], "", {
    nativeRespond: async () => { throw new Error("offline"); },
    externalRespond: async () => { externalCalls += 1; return { text: "external" }; },
  });
  assert.equal(externalCalls, 0);
  assert.equal(result.externalAcceleratorUsed, false);
  assert.equal(result.completed, true);
});

test("orchestrator contract makes external inference non-authoritative", () => {
  const contract = nativeIntelligenceOrchestratorContract();
  assert.equal(contract.primarySemanticAuthority, "sierra_native_n2");
  assert.equal(contract.externalInferenceRole, "optional_accelerator_only");
  assert.equal(contract.externalFailureTerminatesConversation, false);
  assert.equal(contract.toolExecutionAuthority, false);
});
