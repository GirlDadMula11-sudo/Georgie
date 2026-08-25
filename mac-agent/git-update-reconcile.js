function parsePorcelainZ(raw = "") {
  if (!raw) return [];
  const parts = String(raw).split("\0").filter(Boolean);
  const rows = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if ((status.includes("R") || status.includes("C")) && parts[i + 1]) i += 1;
    rows.push({ status, path });
  }
  return rows;
}

export async function reconcileRemoteIdenticalDirtyPaths({ repo, run }) {
  if (!repo || typeof run !== "function") throw new Error("REMOTE_IDENTICAL_RECONCILE_ARGS_REQUIRED");
  const first = await run("git", ["-C", repo, "status", "--porcelain", "-z"]);
  const rows = parsePorcelainZ(first.stdout || "");
  if (!rows.length) return { reconciled: true, paths: [], remaining: "" };
  const candidates = [];
  for (const row of rows) {
    if (row.status !== " M" || !row.path) return { reconciled: false, paths: [], remaining: String(first.stdout || "") };
    let remote;
    let local;
    try {
      remote = await run("git", ["-C", repo, "rev-parse", `origin/main:${row.path}`]);
      local = await run("git", ["-C", repo, "hash-object", "--", row.path]);
    } catch {
      return { reconciled: false, paths: [], remaining: String(first.stdout || "") };
    }
    if (String(remote.stdout || "").trim() !== String(local.stdout || "").trim()) return { reconciled: false, paths: [], remaining: String(first.stdout || "") };
    candidates.push(row.path);
  }
  for (const path of candidates) await run("git", ["-C", repo, "restore", "--source=HEAD", "--worktree", "--", path]);
  const after = await run("git", ["-C", repo, "status", "--porcelain", "-z"]);
  return { reconciled: !String(after.stdout || "").trim(), paths: candidates, remaining: String(after.stdout || "") };
}

export { parsePorcelainZ };
