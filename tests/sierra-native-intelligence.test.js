import test from "node:test";
import assert from "node:assert/strict";
import { reliabilityFastResponse } from "../src/reliability-fast-paths.js";
import { sierraNativeConversationResponse, sierraNativeProviderUnavailableResponse, sierraNativeRuntimeContract } from "../src/sierra-native-intelligence.js";

test("casual greeting is answered natively before any external intelligence path",()=>{
  const response=reliabilityFastResponse("What’s up, Georgie?");
  assert.equal(response?.model,"sierra-native-intelligence-v1");
  assert.equal(response?.route?.provider,"sierra_native");
  assert.equal(response?.route?.externalInferenceRequired,false);
  assert.equal(response?.completed,true);
  assert.equal(response?.terminalState,"verified");
  assert.match(response.text,/I’m here/i);
  assert.doesNotMatch(response.text,/credits|api account|external intelligence model/i);
});

test("basic acknowledgements stay on Sierra native runtime",()=>{
  const response=sierraNativeConversationResponse("Aight.");
  assert.equal(response?.native,true);
  assert.equal(response?.nativeKind,"acknowledgement");
  assert.equal(response?.webSearches,0);
});

test("current evidence and governed action requests are not falsely swallowed by social fast path",()=>{
  assert.equal(sierraNativeConversationResponse("Check the current Sierra pipeline status"),null);
  assert.equal(sierraNativeConversationResponse("Send that email"),null);
});

test("provider unavailability cannot terminate Georgie or expose billing as conversational content",()=>{
  const response=sierraNativeProviderUnavailableResponse("Help me think through this complicated decision");
  assert.equal(response?.native,true);
  assert.equal(response?.completed,true);
  assert.equal(response?.route?.provider,"sierra_native");
  assert.doesNotMatch(response.text,/credit|billing|openai|api key/i);
  assert.match(response.text,/still online/i);
});

test("runtime contract makes external models optional accelerators only",()=>{
  const contract=sierraNativeRuntimeContract();
  assert.equal(contract.defaultAuthority,"sierra_native");
  assert.equal(contract.externalModelRole,"optional_accelerator_only");
  assert.equal(contract.providerFailureDoesNotTerminateGeorgie,true);
  assert.equal(contract.socialConversationRequiresExternalInference,false);
});
