import test from "node:test";
import assert from "node:assert/strict";

import {
  deviceAuthRetryDelay,
  isDefinitiveDeviceRejection
} from "../public/device-auth-policy.js";

test("only definitive authentication rejections discard device credentials", () => {
  assert.equal(isDefinitiveDeviceRejection(401), true);
  assert.equal(isDefinitiveDeviceRejection(403), true);
  for (const status of [0, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isDefinitiveDeviceRejection(status), false, `${status} must retain the credential`);
  }
});

test("device authentication retries use bounded backoff", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 99].map(deviceAuthRetryDelay),
    [1_000, 3_000, 10_000, 30_000, 30_000, 30_000]
  );
});
