import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

// Test isolation (CLAUDE.md §10: "each test runs in a transaction that rolls
// back, or against a truncated schema"). This project uses one process-wide
// Prisma client singleton (src/lib/prisma.ts) shared by every route handler,
// so wrapping each test in its own interactive transaction would require
// threading a per-test client through every service function - a much larger
// change than Session 3's scope. Truncate-between-tests is the sanctioned
// alternative and is what's used here; see vitest.config.ts's
// `fileParallelism: false` for why this means test FILES (not individual
// tests within a file) run sequentially against the shared test database.
export async function resetDb(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE "audit_entries", "access_grants", "reminders", "mock_sms", "deliveries", "anc_contacts", "pregnancies", "visits", "patients", "codelist_items", "invite_codes", "refresh_tokens", "otp_codes", "users", "facilities" RESTART IDENTITY CASCADE`;
}

// Rate-limit/lockout counters (lib/rateLimiter.ts) live in Redis, not
// Postgres, and would otherwise leak state between tests that reuse a phone
// number (e.g. a lockout tripped by one test blocking a later one).
export async function resetRedis(): Promise<void> {
  await redis.flushdb();
}
