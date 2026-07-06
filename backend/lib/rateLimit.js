/**
 * Simple in-memory fixed-window rate limiter.
 *
 * State is keyed by an arbitrary string (typically `req.ip` or a namespaced
 * session id). Not suitable for multi-process deploys — fine for a single
 * CME.exe container.
 *
 * @typedef {Object} RateLimitResult
 * @property {boolean} allowed
 * @property {number} remaining  Requests left in the current window.
 * @property {number} retryAfterMs  Milliseconds until the window resets (0 when allowed).
 */

/** @type {Map<string, { count: number, windowStart: number }>} */
const buckets = new Map();

/**
 * @param {Object} opts
 * @param {string} opts.key      Stable identifier for the caller (e.g. req.ip).
 * @param {number} opts.limit    Max requests allowed within the window.
 * @param {number} opts.windowMs Window length in milliseconds.
 * @returns {RateLimitResult}
 */
export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterMs: 0 };
  }

  if (bucket.count < limit) {
    bucket.count += 1;
    return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfterMs: 0 };
  }

  return {
    allowed: false,
    remaining: 0,
    retryAfterMs: Math.max(0, windowMs - (now - bucket.windowStart)),
  };
}
