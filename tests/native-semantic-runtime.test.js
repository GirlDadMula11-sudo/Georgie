import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeSemanticRequest,
  nativeSemanticEndpointConfig,
  nativeSemanticRespond,
  nativeSemanticRuntimeContract,
  nativeSemanticRuntimeStatus,
  resetNativeSemanticRuntimeStateForTests,
} from "../src/native-semantic-runtime.js";

function config(overrides = {}) {
  return {
    url: "http://127.0.0.1:8080/v1/chat/completions",
    isLoopback: true,
    allowRemote: false,
    timeoutMs: 1000,
    maxOutputChars: 24000,
    failureThreshold: 2,
    circuitMs: 5000,
    model: "test-native",
    enabled: true,
    ...overrides,
  };
}

function jsonResponse(object, { status = 200, contentType = "application/json" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? contentType : null },
    async json() { return { choices: [{ message: { content: JSON.stringify(object) } }] }; },
  };
}

test("N2 request is reasoning-only and schema constrained", () => {
  const request = buildNativeSemanticRequest({ input: "Analyze this architecture", history: [{ role: "assistant", content: "Prior state" }], context: "verified evidence" });
  assert.equal(request.temperature, 0);
  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.response_format.json_schema.strict, true);
  assert.match(request.messages[0].content, /zero execution authority/i);
  assert.match(request.messages[0].content, /untrusted data/i);
  assert.equal(request.response_format.json_schema.schema.properties.authority_request.enum[0], "none");
});

test("loopback is allowed by default and remote inference is denied by default", () => {
  const local = nativeSemanticEndpointConfig({ SIERRA_NATIVE_SEMANTIC_ENABLED: "true" });
  assert.equal(local.isLoopback, true);
  assert.throws(
    () => nativeSemanticEndpointConfig({ SIERRA_NATIVE_SEMANTIC_ENABLED: "true", SIERRA_NATIVE_SEMANTIC_URL: "https://inference.example.com/v1/chat/completions" }),
    (error) => error.code === "native_semantic_remote_denied",
  );
});

test("explicit remote inference still requires TLS", () => {
  assert.throws(
    () => nativeSemanticEndpointConfig({ SIERRA_NATIVE_SEMANTIC_ENABLED: "true", SIERRA_NATIVE_SEMANTIC_ALLOW_REMOTE: "true", SIERRA_NATIVE_SEMANTIC_URL: "http://10.1.2.3:8080/v1/chat/completions" }),
    (error) => error.code === "native_semantic_remote_tls_required",
  );
});

test("valid native inference produces a Sierra-native semantic result", async () => {
  resetNativeSemanticRuntimeStateForTests();
  const result = await nativeSemanticRespond("Explain the tradeoff", [], "", {
    config: config(),
    fetchImpl: async () => jsonResponse({ text: "Use the smaller reversible change first.", confidence: "high", needs_current_evidence: false, authority_request: "none" }),
  });
  assert.equal(result.native, true);
  assert.equal(result.completed, true);
  assert.equal(result.route.provider, "sierra_native");
  assert.equal(result.route.externalInferenceRequired, false);
  assert.equal(result.authorityRequest, "none");
  assert.match(result.model, /^sierra-native:/);
});

test("client rejects authority escalation even if the inference server emits it", async () => {
  resetNativeSemanticRuntimeStateForTests();
  await assert.rejects(
    nativeSemanticRespond("Deploy it", [], "", {
      config: config(),
      fetchImpl: async () => jsonResponse({ text: "I deployed it.", confidence: "high", needs_current_evidence: false, authority_request: "deploy" }),
    }),
    (error) => error.code === "native_semantic_authority_violation",
  );
});

test("client rejects extra fields so server-side structured-output failure cannot fail open", async () => {
  resetNativeSemanticRuntimeStateForTests();
  await assert.rejects(
    nativeSemanticRespond("Analyze", [], "", {
      config: config(),
      fetchImpl: async () => jsonResponse({ text: "Result", confidence: "high", needs_current_evidence: false, authority_request: "none", tool_call: { name: "email.send" } }),
    }),
    (error) => error.code === "native_semantic_unexpected_field",
  );
});

test("non-JSON model content fails closed", async () => {
  resetNativeSemanticRuntimeStateForTests();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    async json() { return { choices: [{ message: { content: "Sure, here is the answer" } }] }; },
  });
  await assert.rejects(nativeSemanticRespond("Analyze", [], "", { config: config(), fetchImpl }), (error) => error.code === "native_semantic_non_json");
});

test("redirects are explicitly denied at the transport contract", async () => {
  resetNativeSemanticRuntimeStateForTests();
  let seen;
  await nativeSemanticRespond("Analyze", [], "", {
    config: config(),
    fetchImpl: async (_url, options) => {
      seen = options;
      return jsonResponse({ text: "Done", confidence: "medium", needs_current_evidence: false, authority_request: "none" });
    },
  });
  assert.equal(seen.redirect, "error");
});

test("repeated native failures open a bounded circuit", async () => {
  resetNativeSemanticRuntimeStateForTests();
  const failing = async () => { throw new Error("connection refused"); };
  const c = config({ failureThreshold: 2, circuitMs: 10000 });
  await assert.rejects(nativeSemanticRespond("one", [], "", { config: c, fetchImpl: failing }), /connection refused/);
  await assert.rejects(nativeSemanticRespond("two", [], "", { config: c, fetchImpl: failing }), /connection refused/);
  await assert.rejects(nativeSemanticRespond("three", [], "", { config: c, fetchImpl: failing }), (error) => error.code === "native_semantic_circuit_open");
});

test("runtime contract keeps semantic inference separate from execution authority", () => {
  const contract = nativeSemanticRuntimeContract();
  assert.equal(contract.authority, "reasoning_only");
  assert.equal(contract.executionAuthority, false);
  assert.equal(contract.clientSideSchemaValidationRequired, true);
  assert.equal(contract.externalProviderDependency, false);
});

test("status reports disabled rather than pretending local inference is live", () => {
  resetNativeSemanticRuntimeStateForTests();
  const status = nativeSemanticRuntimeStatus({ SIERRA_NATIVE_SEMANTIC_ENABLED: "false" });
  assert.equal(status.enabled, false);
  assert.equal(status.readyByConfiguration, false);
});
