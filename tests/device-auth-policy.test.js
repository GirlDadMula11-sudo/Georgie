import test from "node:test";
import assert from "node:assert/strict";

import {
  deviceAuthRetryDelay,
  isDefinitiveDeviceRejection
} from "../public/device-auth-policy.js";

test("generic auth failures retain trusted device credentials", () => {
  for (const status of [0, 401, 403, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isDefinitiveDeviceRejection(status), false, `${status} must retain the credential without an explicit revocation code`);
  }
});

test("only explicit device revocation/invalidity discards credentials", () => {
  assert.equal(isDefinitiveDeviceRejection(401,"device_token_invalid"), true);
  assert.equal(isDefinitiveDeviceRejection(401,"device_identity_mismatch"), true);
  assert.equal(isDefinitiveDeviceRejection(410,"device_revoked"), true);
});

test("device authentication retries use bounded backoff", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 99].map(deviceAuthRetryDelay),
    [1_000, 3_000, 10_000, 30_000, 30_000, 30_000]
  );
});
