import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("terminal reconciliation installer accepts the bounded automatic recovery contract", () => {
  const installer = fs.readFileSync(new URL("../scripts/install-terminal-mac-reconciliation.mjs", import.meta.url), "utf8");
  const connector = fs.readFileSync(new URL("../src/governed-connector.js", import.meta.url), "utf8");

  assert.match(installer, /modernBoundedRecovery/);
  assert.match(installer, /TERMINAL_RECONCILIATION_RECOVERY_CONTRACT_MISSING/);
  assert.match(connector, /function scheduleRecovery\(userId,command,lease\)/);
  assert.match(connector, /boundedRecoveryMaxAttempts/);
  assert.match(connector, /outcome\?\.status==="recovering"/);
});
