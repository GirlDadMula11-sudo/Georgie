const GITHUB_BASE = "https://api.github.com";
const DEFAULT_ALLOWED = ["GirlDadMula11-sudo/Georgie", "GirlDadMula11-sudo/Sierra-Partner-Portal"];

function token() { return String(process.env.GEORGIE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim(); }
function allowedRepositories() {
  const configured = String(process.env.GEORGIE_GITHUB_ALLOWED_REPOSITORIES || "").split(",").map(v => v.trim()).filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED);
}
function assertRepository(repository) {
  const repo = String(repository || "").trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw Object.assign(new Error("repository must be owner/name"), { code: "malformed_request" });
  if (!allowedRepositories().has(repo)) throw Object.assign(new Error(`repository is outside Georgie's GitHub allowlist: ${repo}`), { code: "permission_denied" });
  return repo;
}
function classify(error, response) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  if (!response) return error?.code || "connector_unavailable";
  if (response.status === 401) return "authentication_missing";
  if (response.status === 403) return "permission_denied";
  if (response.status === 404) return "not_found";
  if (response.status >= 500) return "connector_unavailable";
  return "provider_error";
}
async function request(method, path, { body, expected = [200], timeoutMs = 8000 } = {}) {
  const credential = token();
  if (!credential) return { ok: false, error: { code: "authentication_missing", message: "GEORGIE_GITHUB_TOKEN or GITHUB_TOKEN is not configured" } };
  let response;
  try {
    response = await fetch(`${GITHUB_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${credential}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28"
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { return { ok: false, error: { code: "malformed_response", message: "GitHub returned a non-JSON response", status: response.status } }; }
    }
    if (!expected.includes(response.status)) {
      return { ok: false, error: { code: classify(null, response), message: String(payload?.message || `GitHub request failed (${response.status})`).slice(0, 500), status: response.status } };
    }
    return { ok: true, status: response.status, data: payload };
  } catch (error) {
    return { ok: false, error: { code: classify(error, response), message: error instanceof Error ? error.message : String(error) } };
  }
}

export function githubSourceConfigured() { return Boolean(token()); }

export async function listRepositories() {
  const result = await request("GET", "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member");
  if (!result.ok) return result;
  const allowed = allowedRepositories();
  return { ok: true, repositories: (Array.isArray(result.data) ? result.data : []).filter(r => allowed.has(r.full_name)).map(r => ({ repository: r.full_name, private: Boolean(r.private), defaultBranch: r.default_branch, archived: Boolean(r.archived) })) };
}
export async function getRepository(repository) {
  const repo = assertRepository(repository);
  const result = await request("GET", `/repos/${repo}`);
  if (!result.ok) return result;
  return { ok: true, repository: { repository: result.data.full_name, private: Boolean(result.data.private), defaultBranch: result.data.default_branch, archived: Boolean(result.data.archived), permissions: result.data.permissions || null } };
}
export async function listBranches(repository) {
  const repo = assertRepository(repository);
  const result = await request("GET", `/repos/${repo}/branches?per_page=100`);
  if (!result.ok) return result;
  return { ok: true, branches: (Array.isArray(result.data) ? result.data : []).map(b => ({ name: b.name, sha: b.commit?.sha || null, protected: Boolean(b.protected) })) };
}
export async function getBranch(repository, branch = "main") {
  const repo = assertRepository(repository);
  const result = await request("GET", `/repos/${repo}/branches/${encodeURIComponent(String(branch || "main"))}`);
  if (!result.ok) return result;
  return { ok: true, branch: { name: result.data.name, sha: result.data.commit?.sha || null, protected: Boolean(result.data.protected) } };
}
export async function readFile(repository, path, ref = "main") {
  const repo = assertRepository(repository);
  const safePath = String(path || "").replace(/^\/+/, "");
  if (!safePath || /(^|\/)\.env($|\.)|(^|\/)(node_modules|\.git)(\/|$)/i.test(safePath)) return { ok: false, error: { code: "permission_denied", message: "secret or generated paths are not readable" } };
  const result = await request("GET", `/repos/${repo}/contents/${safePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(String(ref || "main"))}`);
  if (!result.ok) return result;
  if (result.data?.type !== "file" || result.data?.encoding !== "base64") return { ok: false, error: { code: "malformed_response", message: "GitHub content response was not a base64 file" } };
  return { ok: true, file: { repository: repo, path: safePath, ref, sha: result.data.sha, content: Buffer.from(String(result.data.content || "").replace(/\n/g, ""), "base64").toString("utf8") } };
}
export async function searchSource(repository, query) {
  const repo = assertRepository(repository);
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: { code: "malformed_request", message: "source search query is required" } };
  const result = await request("GET", `/search/code?q=${encodeURIComponent(`${q} repo:${repo}`)}&per_page=30`);
  if (!result.ok) return result;
  return { ok: true, matches: (Array.isArray(result.data?.items) ? result.data.items : []).map(item => ({ path: item.path, sha: item.sha, url: item.html_url })) };
}
export async function createBranch(repository, branch, baseRef = "main") {
  const repo = assertRepository(repository);
  const base = await getBranch(repo, baseRef);
  if (!base.ok) return base;
  return request("POST", `/repos/${repo}/git/refs`, { body: { ref: `refs/heads/${String(branch || "").trim()}`, sha: base.branch.sha }, expected: [201] });
}
export async function createFileCommit(repository, { path, content, message, branch, expectedBlobSha = null } = {}) {
  const repo = assertRepository(repository);
  const safePath = String(path || "").replace(/^\/+/, "");
  if (!safePath || !branch || !message) return { ok: false, error: { code: "malformed_request", message: "path, branch, and message are required" } };
  const body = { message: String(message), content: Buffer.from(String(content ?? ""), "utf8").toString("base64"), branch: String(branch) };
  if (expectedBlobSha) body.sha = String(expectedBlobSha);
  const result = await request("PUT", `/repos/${repo}/contents/${safePath.split("/").map(encodeURIComponent).join("/")}`, { body, expected: [200, 201] });
  if (!result.ok) return result;
  return { ok: true, commit: { sha: result.data?.commit?.sha || null, path: result.data?.content?.path || safePath, blobSha: result.data?.content?.sha || null } };
}
export async function createPullRequest(repository, { title, head, base = "main", body = "" } = {}) {
  const repo = assertRepository(repository);
  if (!title || !head) return { ok: false, error: { code: "malformed_request", message: "title and head are required" } };
  const result = await request("POST", `/repos/${repo}/pulls`, { body: { title: String(title), head: String(head), base: String(base || "main"), body: String(body || "") }, expected: [201] });
  if (!result.ok) return result;
  return { ok: true, pullRequest: { number: result.data?.number, url: result.data?.html_url, headSha: result.data?.head?.sha, baseSha: result.data?.base?.sha } };
}
