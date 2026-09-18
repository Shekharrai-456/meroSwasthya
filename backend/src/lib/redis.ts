import { Redis } from 'ioredis';
import { config } from '../config.js';

// One client per process, same pattern as lib/prisma.ts. Used for: the OTP-
// request and PIN-login fixed-window rate limiters (keyed on fields only
// available after body parsing, so @fastify/rate-limit's IP-only global
// plugin can't express them - see lib/rateLimiter.ts) and the PIN-lockout
// failure counter (REQ-AUTH-006). BullMQ (Phase 8) will reuse this same URL
// with its own client, per docs/ARCHITECTURE.md §9.
export const redis = new Redis(config.REDIS_URL, {
  // Fail fast in tests/health checks rather than queuing commands indefinitely
  // against an unreachable Redis, and don't retry forever in the background
  // (this sandbox has no Redis reachable - see docs/PROGRESS.md's Session 3
  // entry - so an unbounded retryStrategy would just spam reconnect attempts).
  maxRetriesPerRequest: 2,
  lazyConnect: true,
  retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 200, 1000)),
});

redis.on('error', (_err) => {
  // ioredis emits 'error' on every failed reconnect attempt; without a
  // listener, Node treats an unhandled 'error' event as a fatal exception.
  // Actual failures still surface to callers via the rejected command promise
  // (health.ts, lib/rateLimiter.ts) - this listener only prevents a crash.
});
