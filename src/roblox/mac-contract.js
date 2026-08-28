import path from "node:path";

export const ROBLOX_MAC_ACTIONS = new Set([
  "roblox.inspect_toolchain",
  "roblox.sync_project",
  "roblox.static_check",
  "roblox.launch_private_test",
  "roblox.capture_evidence"
]);

export function validateRobloxWorkspace(input = {}) {
  const root = path.resolve(String(input.root || ""));
  const allowedRoot = path.resolve(String(input.allowedRoot || ""));
  if (!allowedRoot || root !== allowedRoot) throw new Error("ROBLOX_WORKSPACE_NOT_ALLOWLISTED");
  if (input.publicPublish === true) throw new Error("ROBLOX_PUBLIC_PUBLISH_PROHIBITED");
  if (input.purchaseAssets === true) throw new Error("ROBLOX_ASSET_PURCHASE_PROHIBITED");
  return root;
}

export function buildRobloxToolchainProbe(input = {}) {
  const workspace = validateRobloxWorkspace(input);
  return {
    workspace,
    commands: [
      { binary: "/usr/bin/test", args: ["-d", "/Applications/RobloxStudio.app"] },
      { binary: "/usr/bin/which", args: ["rojo"] },
      { binary: "/usr/bin/which", args: ["luau-analyze"] },
      { binary: "/usr/bin/git", args: ["-C", workspace, "status", "--short"] }
    ],
    timeoutMs: 15000,
    secretsReadable: false,
    mutationPerformed: false
  };
}

export function normalizeRobloxReceipt(input = {}) {
  return {
    action: String(input.action || ""),
    objectiveId: String(input.objectiveId || ""),
    checkpointId: String(input.checkpointId || ""),
    startedAt: String(input.startedAt || ""),
    completedAt: String(input.completedAt || ""),
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : null,
    artifactHashes: Array.isArray(input.artifactHashes) ? input.artifactHashes.map(String) : [],
    screenshotHashes: Array.isArray(input.screenshotHashes) ? input.screenshotHashes.map(String) : [],
    privateExperienceId: input.privateExperienceId ? String(input.privateExperienceId) : null,
    publicAccess: false,
    credentialsTransferred: false
  };
}
