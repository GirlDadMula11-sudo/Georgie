import test from "node:test";
import assert from "node:assert/strict";
import { connectorRegistrationStatus } from "../src/connector-oauth.js";

test("connector registration status exposes booleans only and never secrets", () => {
  const prior = {
    origin: process.env.GEORGIE_PUBLIC_ORIGIN,
    token: process.env.GEORGIE_CONNECTOR_TOKEN,
    clientId: process.env.GEORGIE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GEORGIE_OAUTH_CLIENT_SECRET,
    redirect: process.env.GEORGIE_OAUTH_REDIRECT_URI,
  };
  process.env.GEORGIE_PUBLIC_ORIGIN = "https://georgie.example.com";
  process.env.GEORGIE_CONNECTOR_TOKEN = "top-secret-token";
  process.env.GEORGIE_OAUTH_CLIENT_ID = "client-123";
  process.env.GEORGIE_OAUTH_CLIENT_SECRET = "client-secret-456";
  process.env.GEORGIE_OAUTH_REDIRECT_URI = "https://chatgpt.example.com/callback";
  try {
    const status = connectorRegistrationStatus();
    assert.equal(status.ready, true);
    assert.equal(status.origin, "https://georgie.example.com");
    assert.equal(status.mcpEndpoint, "https://georgie.example.com/mcp");
    assert.equal(status.oauthMetadata, "https://georgie.example.com/.well-known/oauth-authorization-server");
    assert.equal(status.protectedResourceMetadata, "https://georgie.example.com/.well-known/oauth-protected-resource/mcp");
    assert.deepEqual(status.configured, {
      connectorToken: true,
      oauthClientId: true,
      oauthClientSecret: true,
      oauthRedirectUri: true,
    });
    assert.equal(JSON.stringify(status).includes("top-secret-token"), false);
    assert.equal(JSON.stringify(status).includes("client-secret-456"), false);
  } finally {
    process.env.GEORGIE_PUBLIC_ORIGIN = prior.origin;
    process.env.GEORGIE_CONNECTOR_TOKEN = prior.token;
    process.env.GEORGIE_OAUTH_CLIENT_ID = prior.clientId;
    process.env.GEORGIE_OAUTH_CLIENT_SECRET = prior.clientSecret;
    process.env.GEORGIE_OAUTH_REDIRECT_URI = prior.redirect;
  }
});

test("connector registration readiness fails closed when required OAuth config is incomplete", () => {
  const prior = {
    token: process.env.GEORGIE_CONNECTOR_TOKEN,
    clientId: process.env.GEORGIE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GEORGIE_OAUTH_CLIENT_SECRET,
    redirect: process.env.GEORGIE_OAUTH_REDIRECT_URI,
  };
  process.env.GEORGIE_CONNECTOR_TOKEN = "token";
  process.env.GEORGIE_OAUTH_CLIENT_ID = "client";
  delete process.env.GEORGIE_OAUTH_CLIENT_SECRET;
  process.env.GEORGIE_OAUTH_REDIRECT_URI = "https://example.com/callback";
  try {
    const status = connectorRegistrationStatus();
    assert.equal(status.ready, false);
    assert.deepEqual(status.missing, ["GEORGIE_OAUTH_CLIENT_SECRET"]);
  } finally {
    process.env.GEORGIE_CONNECTOR_TOKEN = prior.token;
    process.env.GEORGIE_OAUTH_CLIENT_ID = prior.clientId;
    process.env.GEORGIE_OAUTH_CLIENT_SECRET = prior.clientSecret;
    process.env.GEORGIE_OAUTH_REDIRECT_URI = prior.redirect;
  }
});
