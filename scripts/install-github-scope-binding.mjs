import fs from "node:fs";

const fastIntentsPath = new URL("../src/fast-intents.js", import.meta.url);
let source = fs.readFileSync(fastIntentsPath, "utf8");

if (!source.includes("function githubRepositoryFrom")) {
  const anchor = 'function referenceFrom(text = "") {\n';
  if (!source.includes(anchor)) throw new Error("github scope installer could not find fast-intents helper anchor");
  const helper = `function githubRepositoryFrom(text = "") {\n  const matches = [...String(text || "").matchAll(/\\b([A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)\\b/g)].map(match => match[1]);\n  const unique = [...new Set(matches.filter(value => value.toLowerCase().includes("girldadmula11-sudo/") || /github/i.test(String(text || ""))))];\n  if (unique.length > 1) return { error: "conflicting_repository_scope", repositories: unique };\n  return unique.length === 1 ? { repository: unique[0] } : { repository: null };\n}\n\n`;
  source = source.replace(anchor, helper + anchor);
}

if (!source.includes("githubReadOnlyCertification")) {
  const anchor = '  const phase2EngineeringInspection = /\\b(?:github|vercel|render)\\b/.test(lower)\n';
  if (!source.includes(anchor)) throw new Error("github scope installer could not find deterministic plan anchor");
  const block = `  const githubScope = githubRepositoryFrom(text);\n  const githubReadOnlyCertification = /\\b(?:github|repository)\\b/.test(lower)\n    && /\\b(?:certif(?:y|ication)|read[- ]only|repository\\.list|repository\\.get|branch\\.list|branch\\.get|file\\.read|source\\.search)\\b/.test(lower);\n  if (githubReadOnlyCertification) {\n    if (githubScope.error) return [{tool:"github.repository.get",args:{repository:null,scopeError:githubScope.error,conflictingRepositories:githubScope.repositories}}];\n    if (!githubScope.repository) return [{tool:"github.repository.get",args:{repository:null,scopeError:"missing_repository_scope"}}];\n    const repository = githubScope.repository;\n    return [\n      {tool:"github.repository.list",args:{}},\n      {tool:"github.repository.get",args:{repository}},\n      {tool:"github.branch.list",args:{repository}},\n      {tool:"github.branch.get",args:{repository,branch:"main"}},\n      {tool:"github.file.read",args:{repository,path:"package.json",ref:"main"}},\n      {tool:"github.source.search",args:{repository,query:"referrals"}}\n    ];\n  }\n`;
  source = source.replace(anchor, block + anchor);
}

fs.writeFileSync(fastIntentsPath, source);
console.log("[Georgie] GitHub repository scope binding installed.");
