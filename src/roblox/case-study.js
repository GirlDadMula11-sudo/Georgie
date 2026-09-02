import crypto from "node:crypto";

export const REQUIRED_ROBLOX_CASE_STUDY_EVIDENCE = Object.freeze([
  "objective",
  "acceptanceCriteria",
  "sourceCommit",
  "staticCheckReceipt",
  "studioLaunchReceipt",
  "privateExperienceId",
  "playtestReceipt",
  "revisionReceipt",
  "finalPlayableReceipt"
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

export function evidenceHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function certifyRobloxCaseStudy(input = {}) {
  const evidence = input.evidence && typeof input.evidence === "object" ? input.evidence : {};
  const missing = REQUIRED_ROBLOX_CASE_STUDY_EVIDENCE.filter(key => {
    const value = evidence[key];
    return value === undefined || value === null || value === "" || value === false;
  });
  const privacy = {
    childRealNameExcluded: input.privacy?.childRealNameExcluded === true,
    childAccountIdExcluded: input.privacy?.childAccountIdExcluded === true,
    publicAccessDisabled: input.privacy?.publicAccessDisabled === true
  };
  const privacyFailures = Object.entries(privacy).filter(([, ok]) => !ok).map(([key]) => key);
  const passed = missing.length === 0 && privacyFailures.length === 0;

  return {
    accepted: passed,
    state: passed ? "CERTIFIED" : "UNVERIFIED",
    claimAllowed: passed,
    missingEvidence: missing,
    privacyFailures,
    caseStudyId: passed ? `ROBLOX-${evidenceHash(evidence).slice(0, 16).toUpperCase()}` : null,
    evidenceHash: passed ? evidenceHash(evidence) : null,
    investorClaim: passed
      ? "Georgie planned, coded, tested, and iteratively developed an original private Roblox experience from human creative direction, supported by an auditable execution record."
      : null,
    prohibitedClaims: passed ? [] : [
      "Georgie developed a Roblox game",
      "Georgie autonomously completed the Roblox experience",
      "Roblox development capability is certified"
    ]
  };
}

export function createPlaytestRevision(input = {}) {
  const feedback = String(input.feedback || "").trim();
  if (!feedback) throw new Error("PLAYTEST_FEEDBACK_REQUIRED");
  return {
    type: "roblox.playtest_revision",
    recordedAt: new Date().toISOString(),
    testerRole: "minor_creative_director",
    feedback,
    requestedChanges: Array.isArray(input.requestedChanges)
      ? input.requestedChanges.map(String).filter(Boolean).slice(0, 20)
      : [],
    personalIdentifiersStored: false
  };
}
