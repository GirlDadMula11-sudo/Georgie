// Narrow regression suite for the Phase-2 WordPress result-transport boundary only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyWordpressResultTransportRepair,
  buildWordpressAdminJxaEnvelopeScript,
  parseWordpressAdminJxaEnvelope
} from "../scripts/wordpress-result-transport-repair-lib.mjs";

const RUN_START = "async function runWordpressAdminPageScript(pageScript){";
const RUN_END = "\nasync function executeSeoPhase2WordpressBatch";

test("JXA transport is restricted to the Sierra wp-admin origin and uses Chrome execute", () => {
  const script = buildWordpressAdminJxaEnvelopeScript("JSON.stringify({ok:true})");
  assert.match(script, /Application\('Google Chrome'\)/);
  assert.match(script, /https:\/\/sierramarketinginc\.com\/wp-admin\//);
  assert.match(script, /browserTab\.execute\(\{javascript:/);
  assert.doesNotMatch(script, /tell application|return execute browserTab javascript/i);
});

test("serialized object result round-trips deterministically", () => {
  const payload = { ok: true, changedCount: 0, verified: true };
  const envelope = JSON.stringify({ found: true, rawResult: JSON.stringify(payload) });
  assert.deepEqual(parseWordpressAdminJxaEnvelope(envelope), payload);
});

test("admin-tab-not-found and missing or malformed results fail closed", () => {
  assert.throws(() => parseWordpressAdminJxaEnvelope(JSON.stringify({ found: false, rawResult: null })), /No approved Sierra WordPress admin tab/);
  for (const rawResult of [null, "", "missing value"]) {
    assert.throws(() => parseWordpressAdminJxaEnvelope(JSON.stringify({ found: true, rawResult })), /WORDPRESS_JAVASCRIPT_RESULT_NOT_SERIALIZED/);
  }
  assert.throws(() => parseWordpressAdminJxaEnvelope("not-json"), /WORDPRESS_JAVASCRIPT_RESULT_ENVELOPE_INVALID/);
  assert.throws(() => parseWordpressAdminJxaEnvelope(JSON.stringify({ found: true, rawResult: "not-json" })), /WORDPRESS_JAVASCRIPT_RESULT_PAYLOAD_INVALID/);
});

test("repair replaces only the Phase-2 AppleScript result boundary and preserves duplicate no-replay guard", () => {
  const source = fs.readFileSync("mac-agent/agent.js", "utf8");
  const start = source.indexOf(RUN_START);
  const end = source.indexOf(RUN_END, start);
  assert.ok(start >= 0 && end > start, "expected current Phase-2 helper anchors");
  const result = applyWordpressResultTransportRepair(source);
  const repairedEnd = result.source.indexOf(RUN_END, start);
  assert.equal(result.source.slice(0, start), source.slice(0, start));
  assert.equal(result.source.slice(repairedEnd), source.slice(end));
  const fixedBlock = result.source.slice(start, repairedEnd);
  assert.match(fixedBlock, /runJxa\(script\)/);
  assert.match(fixedBlock, /buildWordpressAdminJxaEnvelopeScript/);
  assert.doesNotMatch(fixedBlock, /runAppleScript\(script\)|return execute browserTab javascript/);
  assert.match(result.source, /duplicateReplay:true,mutationPerformed:false/);
});

test("repair materializer is idempotent and cannot create a second transport rewrite", () => {
  const source = fs.readFileSync("mac-agent/agent.js", "utf8");
  const first = applyWordpressResultTransportRepair(source);
  const second = applyWordpressResultTransportRepair(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.status, "already_repaired");
  assert.equal(second.source, first.source);
});
