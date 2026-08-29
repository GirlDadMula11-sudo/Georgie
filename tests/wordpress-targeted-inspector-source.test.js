import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("governed WordPress inspector never delegates to the broad browser scanner", () => {
  const source = fs.readFileSync(new URL("../mac-agent/agent.js", import.meta.url), "utf8");
  const start = source.indexOf("async function inspectGovernedWordpressSession");
  const end = source.indexOf("async function repairWordpressLinkIntegrity", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.doesNotMatch(handler, /inspectBrowserTabs/);
  assert.match(handler, /Application\('Google Chrome'\)/);
  assert.match(handler, /wordpressAdminAuthenticated/);
  assert.match(handler, /if \(!approvedUrl\(rawUrl\)\) return/);
});
