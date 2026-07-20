const crypto = require('crypto');

/**
 * Constant-time string comparison for secrets (API tokens, OTP codes).
 * crypto.timingSafeEqual throws on length mismatch, so guard it — the length
 * check itself leaks only the length, which is not secret.
 */
function secureEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = secureEquals;
