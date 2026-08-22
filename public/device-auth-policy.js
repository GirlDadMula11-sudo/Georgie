export const DEVICE_AUTH_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 10_000, 30_000]);

export function isDefinitiveDeviceRejection(status) {
  return status === 401 || status === 403;
}

export function deviceAuthRetryDelay(attempt) {
  const index = Math.max(0, Math.min(Number(attempt) || 0, DEVICE_AUTH_RETRY_DELAYS_MS.length - 1));
  return DEVICE_AUTH_RETRY_DELAYS_MS[index];
}
