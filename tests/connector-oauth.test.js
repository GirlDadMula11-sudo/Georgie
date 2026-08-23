import test from "node:test";
import assert from "node:assert/strict";
import { issueConnectorAccessToken, verifyConnectorAccessToken } from "../src/connector-oauth.js";

test("OAuth access tokens are signed, audience-bound, client-bound, and expiring", () => {
  const prior = { ...process.env };
  process.env.GEORGIE_PUBLIC_ORIGIN = "https://georgie.example";
  process.env.GEORGIE_CONNECTOR_TOKEN = "connector-signing-secret";
  process.env.GEORGIE_OAUTH_CLIENT_ID = "chatgpt-private-client";
  try {
    const token = issueConnectorAccessToken({ clientId: "chatgpt-private-client", ttlSeconds: 60 });
    assert.equal(verifyConnectorAccessToken(`Bearer ${token}`), true);
    assert.equal(verifyConnectorAccessToken(`Bearer ${token}x`), false);
    assert.equal(verifyConnectorAccessToken(`Bearer ${issueConnectorAccessToken({ clientId: "wrong-client", ttlSeconds: 60 })}`), false);
    assert.equal(verifyConnectorAccessToken(`Bearer ${issueConnectorAccessToken({ clientId: "chatgpt-private-client", ttlSeconds: -1 })}`), false);
  } finally {
    process.env = prior;
  }
});
