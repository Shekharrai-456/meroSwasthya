import { redis } from './redis.js';

// Custom Redis-backed limiters for routes whose rate-limit key depends on the
// parsed request body (phone number) rather than just the caller's IP -
// @fastify/rate-limit (plugins/ratelimit.ts) only sees the request at
// onRequest time, before body parsing, so it can only express the global
// 300/min/IP default. These implement the two per-phone limits from
// docs/SECURITY.md rows 2/3 (REQ-AUTH-002, REQ-SEC-001) as plain fixed-window
// counters: INCR then EXPIRE-once-on-first-hit.

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export async function checkFixedWindowLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSec);
  }
  if (count > limit) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

// PIN-login account lockout (docs/SECURITY.md row 2, control (b)): independent
// of caller IP, keyed only on phone - 5 wrong PINs locks that account for 15
// minutes even if the attacker rotates IPs, distinguishing it from the
// request-rate limiter above (control (a), IP+phone), which is checked
// separately by the same route.
const PIN_LOCKOUT_THRESHOLD = 5;
const PIN_LOCKOUT_WINDOW_SEC = 15 * 60;

function pinLockoutKey(phone: string): string {
  return `pin-lockout:${phone}`;
}

export async function checkPinLockout(phone: string): Promise<RateLimitResult> {
  const key = pinLockoutKey(phone);
  const count = await redis.get(key);
  if (count !== null && Number(count) >= PIN_LOCKOUT_THRESHOLD) {
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSec: ttl > 0 ? ttl : PIN_LOCKOUT_WINDOW_SEC };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export async function recordPinFailure(phone: string): Promise<void> {
  const key = pinLockoutKey(phone);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, PIN_LOCKOUT_WINDOW_SEC);
  }
}

export async function clearPinLockout(phone: string): Promise<void> {
  await redis.del(pinLockoutKey(phone));
}
