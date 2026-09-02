export const ROBLOX_CAPABILITY_ID = "creative.roblox_development";

export const ROBLOX_OPERATIONS = new Set([
  "inspect_toolchain",
  "initialize_private_experience",
  "sync_project",
  "run_static_checks",
  "launch_private_test",
  "capture_playtest_evidence",
  "publish_private_revision",
  "certify_case_study"
]);

export const robloxCapabilityContract = Object.freeze({
  capability: ROBLOX_CAPABILITY_ID,
  targetDevice: "primary-mac",
  authority: "roblox_private_development",
  operations: ROBLOX_OPERATIONS,
  prohibitedRoutes: new Set([
    "roblox.public_publish",
    "roblox.monetization.enable",
    "roblox.asset.purchase",
    "roblox.social_message",
    "credentials.read",
    "production.deploy"
  ]),
  isolation: {
    plane: "specialist",
    queue: "roblox-builder",
    maxConcurrentJobs: 1,
    executionTimeoutMs: 120000,
    heartbeatTimeoutMs: 30000,
    checkpointRequired: true,
    blocksCoreRuntime: false
  }
});

export function validateRobloxRequest(input = {}) {
  const operation = String(input.operation || "").toLowerCase();
  const authority = String(input.authority || "").toLowerCase();
  const targetDevice = String(input.targetDevice || "");

  if (!ROBLOX_OPERATIONS.has(operation)) {
    return { accepted: false, code: "ROBLOX_OPERATION_UNSUPPORTED" };
  }
  if (targetDevice !== robloxCapabilityContract.targetDevice) {
    return { accepted: false, code: "ROBLOX_PRIMARY_MAC_REQUIRED" };
  }
  if (authority !== robloxCapabilityContract.authority) {
    return { accepted: false, code: "ROBLOX_AUTHORITY_REJECTED" };
  }
  return {
    accepted: true,
    route: {
      capability: ROBLOX_CAPABILITY_ID,
      operation,
      targetDevice,
      authority,
      queue: robloxCapabilityContract.isolation.queue
    }
  };
}

export function robloxReadiness(input = {}) {
  const checks = {
    macAgentOnline: input.macAgentOnline === true,
    robloxStudioInstalled: input.robloxStudioInstalled === true,
    robloxStudioAuthenticated: input.robloxStudioAuthenticated === true,
    rojoInstalled: input.rojoInstalled === true,
    luauAnalyzerInstalled: input.luauAnalyzerInstalled === true,
    privateExperienceBound: input.privateExperienceBound === true,
    repositoryBound: input.repositoryBound === true
  };
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    state: missing.length === 0 ? "READY" : "BLOCKED",
    ready: missing.length === 0,
    checks,
    missing,
    truthfulClaim: missing.length === 0
      ? "Roblox build lane is configured; live task evidence is still required."
      : "Roblox build lane is not yet configured."
  };
}
