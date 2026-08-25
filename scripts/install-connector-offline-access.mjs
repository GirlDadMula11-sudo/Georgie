import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function patch(relativePath, transform) {
  const target = path.join(root, relativePath);
  const source = fs.readFileSync(target, "utf8");
  const next = transform(source);
  if (next !== source) fs.writeFileSync(target, next);
  return next;
}

const oauth = patch("src/connector-oauth.js", source => {
  let next = source;
  next = next.replaceAll('scopes_supported: ["georgie:command", "georgie:status"]', 'scopes_supported: ["georgie:command", "georgie:status", "offline_access"]');
  next = next.replace('scope: clean(req.query.scope || "georgie:command georgie:status", 500)', 'scope: clean(req.query.scope || "georgie:command georgie:status offline_access", 500)');
  return next;
});

if (!oauth.includes('"offline_access"')) throw new Error("offline_access was not installed into OAuth metadata");
if (!oauth.includes('georgie:command georgie:status offline_access')) throw new Error("offline_access default authorization scope missing");

const readiness = patch("scripts/check-connector-readiness.mjs", source => {
  if (source.includes('offlineAccessAdvertised')) return source;
  return source
    .replace('const oauth = await fetchJson(oauthUrl);', 'const oauth = await fetchJson(oauthUrl);\nconst offlineAccessAdvertised = Array.isArray(oauth.body?.scopes_supported) && oauth.body.scopes_supported.includes("offline_access");')
    .replace('if (!oauth.response.ok || oauth.body?.issuer !== origin || oauth.body?.authorization_endpoint !== `${origin}/oauth/authorize` || oauth.body?.token_endpoint !== `${origin}/oauth/token`) {', 'if (!oauth.response.ok || oauth.body?.issuer !== origin || oauth.body?.authorization_endpoint !== `${origin}/oauth/authorize` || oauth.body?.token_endpoint !== `${origin}/oauth/token` || !offlineAccessAdvertised) {')
    .replace('console.log(JSON.stringify({ ok: true, origin, registrationReady: true, oauthMetadataValid: true, protectedResourceMetadataValid: true, deepMcp, checkedAt: new Date().toISOString() }));', 'console.log(JSON.stringify({ ok: true, origin, registrationReady: true, oauthMetadataValid: true, offlineAccessAdvertised, protectedResourceMetadataValid: true, deepMcp, checkedAt: new Date().toISOString() }));');
});

if (!readiness.includes('offlineAccessAdvertised')) throw new Error("readiness probe does not verify offline_access");
console.log("[Georgie] connector offline_access persistence hardening installed");
