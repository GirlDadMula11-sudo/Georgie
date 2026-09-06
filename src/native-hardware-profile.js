import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const NATIVE_HARDWARE_PROFILE_VERSION = "sierra.native-semantic-hardware.v2";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function defaultRun(command, args = []) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function appleChipSummary(run) {
  if (process.platform !== "darwin") return null;
  const chip = textOrNull(run("sysctl", ["-n", "machdep.cpu.brand_string"]))
    || textOrNull(run("sysctl", ["-n", "hw.model"]));
  const physicalCores = integerOrNull(run("sysctl", ["-n", "hw.physicalcpu"]));
  const performanceCores = integerOrNull(run("sysctl", ["-n", "hw.perflevel0.physicalcpu"]));
  const efficiencyCores = integerOrNull(run("sysctl", ["-n", "hw.perflevel1.physicalcpu"]));
  return { chip, physicalCores, performanceCores, efficiencyCores };
}

function appleAccelerators(run) {
  if (process.platform !== "darwin") return null;
  const raw = run("system_profiler", ["SPDisplaysDataType", "-json"]);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.SPDisplaysDataType) ? parsed.SPDisplaysDataType : [];
    return rows.map((row) => ({
      chipset: textOrNull(row?.sppci_model || row?._name),
      vram: textOrNull(row?.spdisplays_vram || row?.spdisplays_vram_shared),
      metal: textOrNull(row?.spdisplays_metal),
    })).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  } catch {
    return [];
  }
}

function nvidiaAccelerators(run) {
  if (process.platform !== "linux" && process.platform !== "win32") return null;
  const raw = run("nvidia-smi", [
    "--query-gpu=name,uuid,memory.total,compute_cap,driver_version",
    "--format=csv,noheader,nounits",
  ]);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [name, uuid, memoryMiB, computeCapability, driverVersion] = line.split(",").map((part) => part.trim());
    return {
      name: textOrNull(name),
      uuid: textOrNull(uuid),
      memoryMiB: integerOrNull(memoryMiB),
      computeCapability: textOrNull(computeCapability),
      driverVersion: textOrNull(driverVersion),
    };
  }).sort((a, b) => String(a.uuid || a.name || "").localeCompare(String(b.uuid || b.name || "")));
}

function hardwareIdentity({ run = defaultRun, osModule = os } = {}) {
  const cpus = osModule.cpus?.() || [];
  return {
    schema: NATIVE_HARDWARE_PROFILE_VERSION,
    platform: process.platform,
    arch: process.arch,
    cpu: {
      model: textOrNull(cpus[0]?.model),
      logicalCount: cpus.length,
      apple: appleChipSummary(run),
    },
    memory: {
      totalBytes: Number(osModule.totalmem?.() || 0),
    },
    accelerators: {
      apple: appleAccelerators(run),
      nvidia: nvidiaAccelerators(run),
    },
  };
}

function runtimeIdentity({ osModule = os } = {}) {
  return {
    schema: "sierra.native-semantic-runtime-environment.v1",
    osRelease: textOrNull(osModule.release?.()),
    nodeVersion: process.version,
  };
}

export function buildNativeHardwareProfile(options = {}) {
  const hardware = hardwareIdentity(options);
  const runtime = runtimeIdentity(options);
  const hardwareFingerprintSha256 = sha256(canonicalJson(hardware));
  const runtimeFingerprintSha256 = sha256(canonicalJson(runtime));
  return Object.freeze({
    schema: "sierra.native-semantic-host-profile.v2",
    hardware,
    runtime,
    hardwareFingerprintSha256,
    runtimeFingerprintSha256,
    // Backward-compatible alias consumed by the v1 candidate-manifest contract.
    fingerprintSha256: hardwareFingerprintSha256,
  });
}

// Explicit capture name for host-bound qualification code. This is an alias,
// not a second implementation, so hardware identity cannot drift by call site.
export const captureNativeHardwareProfile = buildNativeHardwareProfile;
