import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateCommandEnvelope } from "../src/governed-connector.js";

const source=fs.readFileSync(new URL("../mac-agent/neo-cdp-reader.js",import.meta.url),"utf8");

test("typed NEO CDP verification is exact and read only",()=>{
  const value=validateCommandEnvelope({source:"chatgpt",objectiveId:"SIERRA-LI-MBX-20260823-001",idempotencyKey:"cdp-verify-1",command:"Verify local NEO CDP",metadata:{capability:"primary_mac.neo.cdp_read_only",target_device:"primary-mac",operation:"verify_session",authority:"read_only",prohibited_routes:["cm-100","stale_continuation","gmail","apple_mail","mailbox.write"],mailboxes:["submissions@sierramarketinginc.com","jasonsierra@sierramarketinginc.com"]}});
  assert.equal(value.routing.capability,"primary_mac.neo.cdp_read_only");
  assert.equal(value.routing.operation,"verify_session");
  assert.equal(value.routing.authority,"read_only");
});

test("CDP discovery is loopback-only and content-neutral",()=>{
  assert.match(source,/127\.0\.0\.1/);
  assert.match(source,/NEO_CDP_ENDPOINT_NOT_LOOPBACK/);
  assert.match(source,/method: \"GET\"/);
  assert.match(source,/messageContentAccessed: false/);
  assert.match(source,/credentialsTransferred: false/);
  assert.match(source,/mutationPerformed: false/);
  assert.doesNotMatch(source,/document\.cookie|localStorage|sessionStorage|Authorization|Network\.getAllCookies/);
});
