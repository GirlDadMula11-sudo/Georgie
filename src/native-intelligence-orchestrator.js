import { nativeSemanticRespond } from "./native-semantic-runtime.js";
import { sierraNativeProviderUnavailableResponse } from "./sierra-native-intelligence.js";

export const NATIVE_ORCHESTRATOR_VERSION = "sierra-native-intelligence-orchestrator-v1";

function isCurrentEvidenceRequest(input = "") {
  return /\b(today|tonight|current|currently|latest|recent|right now|news|weather|price|quote|market|score|schedule|law|regulation|availability)\b/i.test(String(input || ""));
}

/**
 * N2 is Georgie's default semantic authority. Optional external inference may be
 * used only as an accelerator after native reasoning and never as a liveness
 * requirement. This function has no tool execution capability.
 */
export async function nativeFirstSemanticResponse(input, history = [], context = "", options = {}) {
  const nativeRespond = options.nativeRespond || nativeSemanticRespond;
  const externalRespond = typeof options.externalRespond === "function" ? options.externalRespond : null;
  const externalEnabled = options.externalEnabled === true;
  let nativeError = null;

  try {
    const native = await nativeRespond(input, history, context, options.nativeOptions || {});
    if (native?.text) {
      // External acceleration is deliberately shadow-only at this stage. It may
      // be benchmarked independently but cannot replace a valid native result.
      if (externalEnabled && externalRespond && options.shadowExternal === true) {
        Promise.resolve()
          .then(() => externalRespond(input, history, context))
          .catch(() => {});
      }
      return Object.freeze({ ...native, orchestrator: NATIVE_ORCHESTRATOR_VERSION, externalAcceleratorUsed: false });
    }
  } catch (error) {
    nativeError = error;
  }

  // A remote/provider model may never be the only thing standing between a
  // user and a response. Even if an optional accelerator is tried and fails,
  // the turn terminates on Sierra-native bounded behavior rather than a billing
  // or provider error.
  if (externalEnabled && externalRespond && options.allowExternalRecovery === true) {
    try {
      const external = await externalRespond(input, history, context);
      if (external?.text) {
        return Object.freeze({
          ...external,
          completed: true,
          terminal: false,
          orchestrator: NATIVE_ORCHESTRATOR_VERSION,
          externalAcceleratorUsed: true,
          nativeUnavailable: true,
          nativeFailureCode: nativeError?.code || "native_semantic_unavailable",
        });
      }
    } catch {
      // Intentionally ignored: provider failure is never a terminal Georgie state.
    }
  }

  const bounded = sierraNativeProviderUnavailableResponse(input);
  return Object.freeze({
    ...bounded,
    completed: true,
    terminal: false,
    terminalState: "native_bounded_continuation",
    orchestrator: NATIVE_ORCHESTRATOR_VERSION,
    externalAcceleratorUsed: false,
    nativeUnavailable: true,
    nativeFailureCode: nativeError?.code || "native_semantic_unavailable",
    needsCurrentEvidence: isCurrentEvidenceRequest(input),
  });
}

export function nativeIntelligenceOrchestratorContract() {
  return Object.freeze({
    version: NATIVE_ORCHESTRATOR_VERSION,
    primarySemanticAuthority: "sierra_native_n2",
    externalInferenceRole: "optional_accelerator_only",
    externalFailureTerminatesConversation: false,
    nativeFailureTerminatesConversation: false,
    toolExecutionAuthority: false,
    externalShadowComparisonSupported: true,
    externalRecoveryRequiresExplicitEnable: true,
  });
}
