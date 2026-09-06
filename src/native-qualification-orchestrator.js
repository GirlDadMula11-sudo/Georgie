import { createHash } from "node:crypto";
import { canonicalJson } from "./native-hardware-profile.js";
import { planNativeSemanticCandidates } from "./native-candidate-planner.js";
import { evaluateN2Promotion } from "./native-semantic-promotion.js";

export const N2_QUALIFICATION_ORCHESTRATOR_VERSION = "sierra.native-semantic-qualification.v1";
const SHA256 = /^[a-f0-9]{64}$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function requiredSha(value, field) {
  const text = String(value || "").trim().toLowerCase();
  if (!SHA256.test(text)) fail("n2_qualification_invalid", `${field} must be a lowercase SHA-256 digest`);
  return text;
}

function requiredObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("n2_qualification_invalid", `${field} must be an object`);
  return value;
}

function requiredArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) fail("n2_qualification_invalid", `${field} must be a non-empty array`);
  return value;
}

function bindEvidence(evidence, expected) {
  const item = requiredObject(evidence, expected.field);
  const candidateManifestSha256 = requiredSha(item.candidateManifestSha256, `${expected.field}.candidateManifestSha256`);
  const hostHardwareFingerprintSha256 = requiredSha(item.hostHardwareFingerprintSha256, `${expected.field}.hostHardwareFingerprintSha256`);
  if (candidateManifestSha256 !== expected.candidateManifestSha256) {
    fail("n2_qualification_binding_mismatch", `${expected.field} belongs to a different candidate manifest`);
  }
  if (hostHardwareFingerprintSha256 !== expected.hostHardwareFingerprintSha256) {
    fail("n2_qualification_binding_mismatch", `${expected.field} belongs to a different hardware host`);
  }
  return item;
}

export function orchestrateN2Qualification({
  hostProfile,
  candidates,
  selectedCandidateId,
  candidateManifest,
  sealed,
  adversarial,
  outage,
  stress,
  shadow,
  corpusSha256,
  requiredContextWindow = 8192,
  requiredConcurrency = 1,
  maxHostMemoryFraction,
} = {}) {
  const host = requiredObject(hostProfile, "hostProfile");
  const candidateList = requiredArray(candidates, "candidates");
  const selectedId = String(selectedCandidateId || "").trim();
  if (!selectedId) fail("n2_qualification_invalid", "selectedCandidateId is required");

  const plan = planNativeSemanticCandidates({
    hostProfile: host,
    candidates: candidateList,
    requiredContextWindow,
    requiredConcurrency,
    maxHostMemoryFraction,
  });

  const selectedPlan = plan.evaluations.find((item) => item.id === selectedId);
  if (!selectedPlan) fail("n2_qualification_invalid", "selected candidate is not present in planner input");
  if (!selectedPlan.admittedForQualification) {
    fail("n2_qualification_candidate_not_admitted", `candidate ${selectedId} was not admitted for qualification`);
  }

  const manifest = requiredObject(candidateManifest, "candidateManifest");
  const manifestHostSha = requiredSha(manifest.hardware?.fingerprintSha256, "candidateManifest.hardware.fingerprintSha256");
  const hostSha = requiredSha(host.hardwareFingerprintSha256, "hostProfile.hardwareFingerprintSha256");
  if (manifestHostSha !== hostSha) fail("n2_qualification_binding_mismatch", "candidate manifest is pinned to a different host");

  const promotionProbe = evaluateN2Promotion({
    manifest,
    sealed: {},
    adversarial: {},
    outage: {},
    stress: {},
    shadow: {},
  });
  const candidateManifestSha256 = promotionProbe.candidateManifestSha256;
  const corpusHash = requiredSha(corpusSha256, "corpusSha256");

  const bound = {
    sealed: bindEvidence(sealed, { field: "sealed", candidateManifestSha256, hostHardwareFingerprintSha256: hostSha }),
    adversarial: bindEvidence(adversarial, { field: "adversarial", candidateManifestSha256, hostHardwareFingerprintSha256: hostSha }),
    outage: bindEvidence(outage, { field: "outage", candidateManifestSha256, hostHardwareFingerprintSha256: hostSha }),
    stress: bindEvidence(stress, { field: "stress", candidateManifestSha256, hostHardwareFingerprintSha256: hostSha }),
    shadow: bindEvidence(shadow, { field: "shadow", candidateManifestSha256, hostHardwareFingerprintSha256: hostSha }),
  };

  const sealedCorpusSha256 = requiredSha(bound.sealed.corpusSha256, "sealed.corpusSha256");
  if (sealedCorpusSha256 !== corpusHash) fail("n2_qualification_binding_mismatch", "sealed evidence belongs to a different corpus");

  const promotion = evaluateN2Promotion({
    manifest,
    sealed: bound.sealed,
    adversarial: bound.adversarial,
    outage: bound.outage,
    stress: bound.stress,
    shadow: bound.shadow,
  });

  const receiptBody = {
    schema: N2_QUALIFICATION_ORCHESTRATOR_VERSION,
    plannerDecisionSha256: plan.plannerDecisionSha256,
    selectedCandidateId: selectedId,
    candidateManifestSha256,
    hostHardwareFingerprintSha256: hostSha,
    corpusSha256: corpusHash,
    promotionDecisionSha256: promotion.decisionSha256,
    productionAuthority: promotion.productionAuthority,
    rollbackTarget: promotion.rollbackTarget,
  };

  return Object.freeze({
    ...receiptBody,
    planner: plan,
    promotion,
    qualificationReceiptSha256: sha256(canonicalJson(receiptBody)),
    nextAction: promotion.productionAuthority === "eligible_for_controlled_canary"
      ? "controlled_canary_only"
      : "remain_on_sierra_native_control",
  });
}
