import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const install = spawnSync(process.execPath, ["scripts/install-github-source-tools.mjs"], { encoding: "utf8" });
if (install.status !== 0) throw new Error(install.stderr || install.stdout || "GitHub source installer failed");
const { deterministicToolPlan } = await import("../src/fast-intents.js?scope-binding-test=" + Date.now());

const target = "GirlDadMula11-sudo/Sierra-Partner-Portal";

test("read-only GitHub certification binds one repository to every operation", () => {
  const plan = deterministicToolPlan(`Run read-only GitHub source certification against ${target}.`);
  assert.deepEqual(plan.map(item => item.tool), [
    "github.repository.list",
    "github.repository.get",
    "github.branch.list",
    "github.branch.get",
    "github.file.read",
    "github.source.search"
  ]);
  for (const action of plan) assert.equal(action.args.repository, target, `${action.tool} must retain repository scope`);
  assert.equal(plan[3].args.branch, "main");
  assert.equal(plan[4].args.path, "package.json");
});

test("GitHub certification fails closed when repository scope is missing", () => {
  assert.throws(() => deterministicToolPlan("Run the read-only GitHub source certification."), /requires one explicit owner\/name repository scope/);
});

test("GitHub certification fails closed on conflicting repository scopes", () => {
  assert.throws(
    () => deterministicToolPlan(`Run read-only GitHub source certification against ${target} and GirlDadMula11-sudo/Georgie.`),
    /Conflicting GitHub repository scope/
  );
});

test("negated GitHub route constraints cannot trigger GitHub certification", () => {
  const prompt = "ROUTE-LOCKED WordPress Hostinger cache purge. Do not call system.github or run GitHub certification. Use primary-mac and verify the public sitemap.";
  const plan = deterministicToolPlan(prompt);
  assert.equal(plan.some(action => String(action.tool).startsWith("github.")), false);
});
