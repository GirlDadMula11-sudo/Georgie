import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createConnectorOAuthRouter, issueConnectorAccessToken, verifyConnectorAccessToken } from "../src/connector-oauth.js";

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

test("OAuth authorization persists through rotating refresh tokens", async () => {
  const prior = { ...process.env };
  const verifier = "connector-pkce-verifier-with-sufficient-entropy";
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const app = express();
  app.use(createConnectorOAuthRouter());
  const server = app.listen(0);
  const port = await new Promise(resolve => server.once("listening", () => resolve(server.address().port)));
  process.env.GEORGIE_PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
  process.env.GEORGIE_CONNECTOR_TOKEN = "connector-signing-secret";
  process.env.GEORGIE_OAUTH_CLIENT_ID = "chatgpt-private-client";
  process.env.GEORGIE_OAUTH_CLIENT_SECRET = "connector-client-secret";
  process.env.GEORGIE_OAUTH_REDIRECT_URI = "https://chatgpt.example/callback";
  try {
    const authorize = new URL(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/authorize`);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: process.env.GEORGIE_OAUTH_CLIENT_ID, redirect_uri: process.env.GEORGIE_OAUTH_REDIRECT_URI, code_challenge: challenge, code_challenge_method: "S256" });
    const approval = await fetch(authorize, { redirect: "manual" });
    const code = new URL(approval.headers.get("location")).searchParams.get("code");
    const common = { client_id: process.env.GEORGIE_OAUTH_CLIENT_ID, client_secret: process.env.GEORGIE_OAUTH_CLIENT_SECRET };
    const exchange = await fetch(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...common, grant_type: "authorization_code", code, redirect_uri: process.env.GEORGIE_OAUTH_REDIRECT_URI, code_verifier: verifier }) });
    const first = await exchange.json();
    assert.equal(exchange.status, 200);
    assert.equal(verifyConnectorAccessToken(`Bearer ${first.access_token}`), true);
    assert.ok(first.refresh_token);
    const refresh = await fetch(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...common, grant_type: "refresh_token", refresh_token: first.refresh_token }) });
    const second = await refresh.json();
    assert.equal(refresh.status, 200);
    assert.equal(verifyConnectorAccessToken(`Bearer ${second.access_token}`), true);
    assert.ok(second.refresh_token);
    assert.notEqual(second.refresh_token, first.refresh_token);
  } finally {
    await new Promise(resolve => server.close(resolve));
    process.env = prior;
  }
});
