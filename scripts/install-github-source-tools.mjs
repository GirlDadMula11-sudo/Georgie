import fs from "node:fs";

const toolsPath = new URL("../src/tools.js", import.meta.url);
let tools = fs.readFileSync(toolsPath, "utf8");
const importLine = 'import { githubSourceConfigured, listRepositories as githubListRepositories, getRepository as githubGetRepository, listBranches as githubListBranches, getBranch as githubGetBranch, readFile as githubReadFile, searchSource as githubSearchSource, createBranch as githubCreateBranch, createFileCommit as githubCreateFileCommit, createPullRequest as githubCreatePullRequest } from "./integrations/github-source.js";\n';
if (!tools.includes("./integrations/github-source.js")) {
  const anchor = 'import { getGithubObservability, getProviderObservability, getRenderObservability, getVercelObservability } from "./integrations/provider-observability.js";\n';
  if (!tools.includes(anchor)) throw new Error("github source installer could not find provider import anchor");
  tools = tools.replace(anchor, anchor + importLine);
}
const registrations = `defineTool({name:"github.repository.list",description:"List allowlisted repositories through authenticated server-side GitHub access. Never uses the Mac agent or public-web fallback.",risk:"read",async run(){return githubListRepositories()}});\ndefineTool({name:"github.repository.get",description:"Read metadata for one allowlisted repository through authenticated server-side GitHub access.",risk:"read",async run({args}){return githubGetRepository(args?.repository)}});\ndefineTool({name:"github.branch.list",description:"List branches and exact head SHAs for one allowlisted repository through authenticated server-side GitHub access.",risk:"read",async run({args}){return githubListBranches(args?.repository)}});\ndefineTool({name:"github.branch.get",description:"Read one branch and exact head SHA through authenticated server-side GitHub access.",risk:"read",async run({args}){return githubGetBranch(args?.repository,args?.branch||"main")}});\ndefineTool({name:"github.file.read",description:"Read a non-secret source file from an allowlisted repository through authenticated server-side GitHub access.",risk:"read",async run({args}){return githubReadFile(args?.repository,args?.path,args?.ref||"main")}});\ndefineTool({name:"github.source.search",description:"Search source in an allowlisted repository through authenticated server-side GitHub access.",risk:"read",async run({args}){return githubSearchSource(args?.repository,args?.query)}});\ndefineTool({name:"github.branch.create",description:"Create a branch in an allowlisted repository. Governed write; never falls back to Mac or public web.",risk:"sensitive_write",async run({args}){return githubCreateBranch(args?.repository,args?.branch,args?.baseRef||"main")}});\ndefineTool({name:"github.commit.create",description:"Create or update one source file as a GitHub commit on an existing branch. Governed write requiring approval.",risk:"sensitive_write",async run({args}){return githubCreateFileCommit(args?.repository,args||{})}});\ndefineTool({name:"github.pull_request.create",description:"Open a pull request in an allowlisted repository. Governed write requiring approval.",risk:"sensitive_write",async run({args}){return githubCreatePullRequest(args?.repository,args||{})}});\n`;
if (!tools.includes('name:"github.repository.list"')) {
  const anchor = "const workforceOnly=true;";
  if (!tools.includes(anchor)) throw new Error("github source installer could not find tool registration anchor");
  tools = tools.replace(anchor, registrations + anchor);
}
fs.writeFileSync(toolsPath, tools);

const manifestPath = new URL("../src/capability-manifest.js", import.meta.url);
let manifest = fs.readFileSync(manifestPath, "utf8");
const manifestImport = 'import { githubSourceConfigured } from "./integrations/github-source.js";\n';
if (!manifest.includes("githubSourceConfigured")) {
  const anchor = 'import { githubObservabilityConfigured, renderObservabilityConfigured, vercelObservabilityConfigured } from "./integrations/provider-observability.js";\n';
  if (!manifest.includes(anchor)) throw new Error("github source installer could not find manifest import anchor");
  manifest = manifest.replace(anchor, anchor + manifestImport);
}
if (!manifest.includes("githubSource:")) {
  const anchor = '      deploymentObservability: {\n        github: configured(github),';
  if (!manifest.includes(anchor)) throw new Error("github source installer could not find manifest connection anchor");
  const replacement = '      githubSource: { state: configured(githubSourceConfigured()), callableInChat: githubSourceConfigured(), access: githubSourceConfigured() ? "authenticated_allowlisted_server_side" : "none", operations: ["repository.list","repository.get","branch.list","branch.get","file.read","source.search","branch.create","commit.create","pull_request.create"], noMacFallback: true, noPublicWebFallback: true },\n' + anchor;
  manifest = manifest.replace(anchor, replacement);
}
fs.writeFileSync(manifestPath, manifest);

const intentsPath = new URL("../src/fast-intents.js", import.meta.url);
let intents = fs.readFileSync(intentsPath, "utf8");
if (!intents.includes("function githubRepositoryScopeFrom")) {
  const anchor = 'function investigationTargetFrom(text=""){';
  if (!intents.includes(anchor)) throw new Error("github scope installer could not find fast-intents helper anchor");
  const helper = `function githubRepositoryScopeFrom(text="") {\n  const matches=[...String(text).matchAll(/\\b([A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)\\b/g)].map(match=>match[1]);\n  const repositories=[...new Set(matches.filter(value=>value.includes("-")||/github|sierra|georgie/i.test(value)))];\n  if(repositories.length>1) throw new Error(\`Conflicting GitHub repository scope: \${repositories.join(", ")}\`);\n  return repositories[0]||null;\n}\n\n`;
  intents = intents.replace(anchor, helper + anchor);
}
if (!intents.includes("githubReadOnlyCertification")) {
  const anchor = '  if (!text) return [];\n';
  if (!intents.includes(anchor)) throw new Error("github scope installer could not find deterministic plan anchor");
  const rule = `  const githubReadOnlyCertification = /\\b(?:run|perform|execute|start)\\b/.test(lower) && /\\bgithub(?:\\s+source)?\\s+certif(?:y|ication)\\b/.test(lower) && !/\\b(?:do not|don't|never|prohibited|denied)\\b[^.\\n]{0,80}\\b(?:system\\.)?github\\b/.test(lower);\n  if (githubReadOnlyCertification) {\n    const repository=githubRepositoryScopeFrom(text);\n    if(!repository) throw new Error("GitHub certification requires one explicit owner/name repository scope");\n    return [\n      {tool:"github.repository.list",args:{repository}},\n      {tool:"github.repository.get",args:{repository}},\n      {tool:"github.branch.list",args:{repository}},\n      {tool:"github.branch.get",args:{repository,branch:"main"}},\n      {tool:"github.file.read",args:{repository,path:"package.json",ref:"main"}},\n      {tool:"github.source.search",args:{repository,query:"referrals"}}\n    ];\n  }\n`;
  intents = intents.replace(anchor, anchor + rule);
}
fs.writeFileSync(intentsPath, intents);
console.log("[Georgie] Governed server-side GitHub source tools installed with repository scope binding.");
