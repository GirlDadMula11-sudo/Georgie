import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const installer = fs.readFileSync(new URL("../scripts/install-smartlead-authority-recovery.mjs", import.meta.url), "utf8");

test("Smartlead authority startup uses outage-safe retry cadence", () => {
  assert.match(installer, /georgie\.smartlead-reply-closer\.v2\.5\.2/);
  assert.match(installer, /retryDelays = \[120_000, 180_000, 240_000, 300_000\]/);
  assert.match(installer, /authorityActivationRetryMinMs: 120000/);
  assert.match(installer, /authorityActivationRetryMaxMs: 300000/);
  assert.doesNotMatch(installer, /retryDelays = \[5_000, 10_000, 20_000, 30_000, 60_000\]/);
});
