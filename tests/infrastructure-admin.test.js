import test from "node:test";
import assert from "node:assert/strict";
import { executeInfrastructureAdmin, infrastructureAdminCapabilities, redactProviderPayload } from "../src/integrations/infrastructure-admin.js";

function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value;
  return Promise.resolve().then(fn).finally(() => {
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
  });
}

test("redacts credentials recursively", () => {
  const result = redactProviderPayload({ token: "abc", nested: { authorization: "Bearer x", email: "safe@example.com" } });
  assert.equal(result.token, "[redacted]");
  assert.equal(result.nested.authorization, "[redacted]");
  assert.equal(result.nested.email, "safe@example.com");
});

test("capability manifest is default-deny and does not expose credentials", async () => {
  await withEnv({ GEORGIE_INFRA_ADMIN_WRITES_ENABLED: undefined, GEORGIE_VERCEL_TOKEN: "secret", GEORGIE_VERCEL_TEAM_ID: "team_x" }, async () => {
    const cap = infrastructureAdminCapabilities();
    assert.equal(cap.defaultDeny, true);
    assert.equal(cap.explicitApprovalForWrites, true);
    assert.equal(cap.rawCredentialsModelVisible, false);
    assert.equal(cap.writesEnabled, false);
    assert.equal(cap.configured.vercel, true);
  });
});

test("write action is blocked when master switch is disabled", async () => {
  await withEnv({ GEORGIE_INFRA_ADMIN_WRITES_ENABLED: "false" }, async () => {
    await assert.rejects(() => executeInfrastructureAdmin("test", { action: "vercel.team.member.invite", email: "louri@example.com", approved: true, approvalId: "approval-1" }), /writes are disabled/i);
  });
});

test("write action requires explicit approval and approval id", async () => {
  await withEnv({ GEORGIE_INFRA_ADMIN_WRITES_ENABLED: "true" }, async () => {
    await assert.rejects(() => executeInfrastructureAdmin("test", { action: "vercel.team.member.invite", email: "louri@example.com" }), /Explicit approval/i);
    await assert.rejects(() => executeInfrastructureAdmin("test", { action: "vercel.team.member.invite", email: "louri@example.com", approved: true }), /approvalId/i);
  });
});

test("Vercel invitation uses allowlisted endpoint and redacts returned invite codes", async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ email: "louri@example.com", inviteCode: "private-code", role: "DEVELOPER" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await withEnv({
      GEORGIE_INFRA_ADMIN_WRITES_ENABLED: "true",
      GEORGIE_VERCEL_TOKEN: "server-only-token",
      GEORGIE_VERCEL_TEAM_ID: "team_123456"
    }, async () => {
      const result = await executeInfrastructureAdmin("test", { action: "vercel.team.member.invite", email: "louri@example.com", role: "DEVELOPER", approved: true, approvalId: "approval-2" });
      assert.equal(result.ok, true);
      assert.equal(result.result.inviteCode, "[redacted]");
      assert.match(request.url, /\/v1\/teams\/team_123456\/members$/);
      assert.equal(request.options.method, "POST");
      assert.deepEqual(JSON.parse(request.options.body), { email: "louri@example.com", role: "DEVELOPER" });
      assert.equal(request.options.headers.authorization, "Bearer server-only-token");
    });
  } finally { global.fetch = originalFetch; }
});

test("Supabase invite refuses guessed/private endpoints and requests governed fallback", async () => {
  await withEnv({
    GEORGIE_INFRA_ADMIN_WRITES_ENABLED: "true",
    GEORGIE_SUPABASE_MANAGEMENT_TOKEN: "server-only-token",
    GEORGIE_SUPABASE_ORGANIZATION_SLUG: "example-org",
    GEORGIE_SUPABASE_MEMBER_INVITE_ENDPOINT: undefined
  }, async () => {
    await assert.rejects(() => executeInfrastructureAdmin("test", { action: "supabase.organization.member.invite", email: "louri@example.com", role: "DEVELOPER", approved: true, approvalId: "approval-3" }), (error) => error?.code === "SUPABASE_DASHBOARD_FALLBACK_REQUIRED");
  });
});
