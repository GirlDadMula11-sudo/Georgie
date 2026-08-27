import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { recoveryDeliveryKey } from "../src/owner-recovery.js";

const install = spawnSync(process.execPath,["scripts/install-owner-recovery.mjs"],{encoding:"utf8"});
if(install.status!==0) throw new Error(install.stderr||install.stdout||"owner recovery installer failed");

const server=fs.readFileSync(new URL("../src/server.js",import.meta.url),"utf8");
const recovery=fs.readFileSync(new URL("../src/owner-recovery.js",import.meta.url),"utf8");
const auth=fs.readFileSync(new URL("../public/device-auth.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");

 test("recovery request is reachable before authenticated mobile router",()=>{
  const recoveryAt=server.indexOf('/api/mobile/recovery/request');
  const routerAt=server.indexOf('app.use("/api/mobile",createMobileRouter())');
  assert.ok(recoveryAt>=0);
  assert.ok(routerAt>recoveryAt);
 });

test("owner recovery destination is fixed by environment, never request payload",()=>{
  assert.match(recovery,/GEORGIE_OWNER_RECOVERY_EMAIL/);
  assert.match(recovery,/GEORGIE_NEO_WORK_EMAIL/);
  assert.doesNotMatch(recovery,/req\.body|args\.email|payload\.email/);
  assert.match(recovery,/PER_CLIENT_LIMIT = 2/);
  assert.match(recovery,/GLOBAL_LIMIT = 5/);
});

test("recovery response never returns enrollment code",()=>{
  assert.match(recovery,/return \{ delivery: "owner_email", destination: maskEmail\(to\), expiresAt: enrollment\.expiresAt \}/);
  assert.doesNotMatch(recovery,/return \{[^}]*code:/);
});

test("recovery delivery satisfies governed outbound idempotency without exposing the code",()=>{
  assert.match(recovery,/idempotencyKey,/);
  assert.match(recovery,/correlationId: idempotencyKey/);
  assert.match(recovery,/rationale:/);
  assert.match(recovery,/evidenceState:/);
  const input={to:"owner@example.com",code:"SECRET-ONE-TIME-CODE",expiresAt:"2030-01-01T00:00:00.000Z"};
  const first=recoveryDeliveryKey(input);
  assert.equal(first,recoveryDeliveryKey(input));
  assert.match(first,/^georgie-owner-recovery:v1:[a-f0-9]{64}$/);
  assert.ok(!first.includes(input.code));
  assert.notEqual(first,recoveryDeliveryKey({...input,code:"A-DIFFERENT-CODE"}));
});

test("duplicate and concurrent recovery requests reuse the active delivery",()=>{
  assert.match(recovery,/const activeRecoveries = new Map\(\)/);
  assert.match(recovery,/if \(active && active\.expiresAtMs > nowMs\(\)\) return active\.promise/);
  assert.match(recovery,/activeRecoveries\.set\(requestKey, \{ promise: work, expiresAtMs:/);
  assert.match(recovery,/activeRecoveries\.delete\(requestKey\)/);
});

test("enrollment UI exposes recovery without weakening activation",()=>{
  assert.match(html,/id="recoveryCodeButton"/);
  assert.match(auth,/\/api\/mobile\/recovery\/request/);
  assert.match(auth,/\/api\/mobile\/enroll/);
  assert.match(auth,/isDefinitiveDeviceRejection/);
});
