import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

function run(cmd, args = []) {
  try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function appleGpuSummary() {
  if (process.platform !== "darwin") return null;
  const raw = run("system_profiler", ["SPDisplaysDataType", "-json"]);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const rows = parsed?.SPDisplaysDataType || [];
    return rows.map((row) => ({
      chipset: row?.sppci_model || row?._name || null,
      vram: row?.spdisplays_vram || row?.spdisplays_vram_shared || null,
      metal: row?.spdisplays_metal || null,
    }));
  } catch { return null; }
}

function linuxGpuSummary() {
  if (process.platform !== "linux") return null;
  const raw = run("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"]);
  if (!raw) return null;
  return raw.split("\n").filter(Boolean).map((line) => {
    const [name, memoryMiB, driver] = line.split(",").map((part) => part.trim());
    return { name, memoryMiB: Number(memoryMiB) || null, driver };
  });
}

const cpus = os.cpus() || [];
const profile = {
  schema: "sierra.native-semantic-hardware.v1",
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  cpuModel: cpus[0]?.model || null,
  logicalCpuCount: cpus.length,
  totalMemoryBytes: os.totalmem(),
  nodeVersion: process.version,
  appleGpu: appleGpuSummary(),
  nvidiaGpu: linuxGpuSummary(),
};
const canonical = JSON.stringify(profile, Object.keys(profile).sort());
const result = { ...profile, fingerprintSha256: sha256(canonical) };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
