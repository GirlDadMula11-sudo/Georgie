import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { connectorAccessClaims, createConnectorOAuthRouter, issueConnectorAccessToken, verifyConnectorAccessToken } from "../src/connector-oauth.js";

const approve = async (base, authorization, allowCommands = false) => {
  const html = await authorization.text();
  const requestId = html.match(/requestId:\s*"([^"]+)"/)?.[1];
  assert.ok(requestId);
  return fetch(`${base}/oauth/authorize/approve`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer enrolled-owner" }, body: JSON.stringify({ requestId, allowCommands }) });
};

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
  app.use(createConnectorOAuthRouter({ authenticateOwner: async () => ({ device_id: "owner-device" }) }));
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
    const authorization = await fetch(authorize);
    const approval = await approve(process.env.GEORGIE_PUBLIC_ORIGIN, authorization, true);
    const code = new URL((await approval.json()).redirect).searchParams.get("code");
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

test("Codex can register a loopback PKCE client only after enrolled-owner approval", async () => {
  const prior = { ...process.env };
  process.env.GEORGIE_CONNECTOR_TOKEN = "connector-signing-secret";
  const app = express(); app.use(createConnectorOAuthRouter({ authenticateOwner: async req => req.headers.authorization === "Bearer enrolled-owner" ? { device_id: "owner-device" } : null })); const server = app.listen(0);
  const port = await new Promise(resolve => server.once("listening", () => resolve(server.address().port)));
  process.env.GEORGIE_PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
  const redirectUri = "http://127.0.0.1/callback/codex-georgie";
  try {
    const registration = await fetch(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }) });
    const registered = await registration.json();
    assert.equal(registration.status, 201); assert.match(registered.client_id, /^dcr_/);
    const verifier = "public-client-pkce-verifier-with-sufficient-entropy";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/authorize`);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: registered.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", resource: `${process.env.GEORGIE_PUBLIC_ORIGIN}/mcp` });
    const authorization = await fetch(authorize);
    const denied = await fetch(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/authorize/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "unknown" }) });
    assert.equal(denied.status, 401);
    const approval = await approve(process.env.GEORGIE_PUBLIC_ORIGIN, authorization, false);
    const location = new URL((await approval.json()).redirect);
    assert.equal(location.searchParams.get("iss"), process.env.GEORGIE_PUBLIC_ORIGIN);
    const exchange = await fetch(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: registered.client_id, code: location.searchParams.get("code"), redirect_uri: redirectUri, code_verifier: verifier, resource: `${process.env.GEORGIE_PUBLIC_ORIGIN}/mcp` }) });
    const first = await exchange.json(); assert.equal(exchange.status, 200); assert.equal(verifyConnectorAccessToken(`Bearer ${first.access_token}`), true);
    assert.equal(connectorAccessClaims(`Bearer ${first.access_token}`).scope.includes("georgie:status"), true);
    assert.equal(connectorAccessClaims(`Bearer ${first.access_token}`).scope.includes("georgie:command"), false);
    const refresh = await fetch(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: registered.client_id, refresh_token: first.refresh_token }) });
    const second = await refresh.json(); assert.equal(refresh.status, 200); assert.equal(verifyConnectorAccessToken(`Bearer ${second.access_token}`), true);
  } finally { await new Promise(resolve => server.close(resolve)); process.env = prior; }
});

test("OAuth metadata advertises issuer-bound callbacks and rejects unsafe redirect schemes", async () => {
  const prior = { ...process.env }; process.env.GEORGIE_CONNECTOR_TOKEN = "connector-signing-secret";
  const app = express(); app.use(createConnectorOAuthRouter({ authenticateOwner: async () => null })); const server = app.listen(0);
  const port = await new Promise(resolve => server.once("listening", () => resolve(server.address().port))); process.env.GEORGIE_PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;
  try {
    const metadata = await (await fetch(`${process.env.GEORGIE_PUBLIC_ORIGIN}/.well-known/oauth-authorization-server`)).json();
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    const rejected = await fetch(`${process.env.GEORGIE_PUBLIC_ORIGIN}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://attacker.example/callback"], token_endpoint_auth_method: "none" }) });
    assert.equal(rejected.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); process.env = prior; }
});
