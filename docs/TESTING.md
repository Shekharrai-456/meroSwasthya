# Testing — Swasthya Card Backend

CLAUDE.md §13 requires this document; it was missing through Sessions 1-7
(found in Session 8's hardening pass) despite every session already following
its intended practice. This restates that practice explicitly, backdated to
what has actually been true since Session 3.

## 1. Strategy

CLAUDE.md §10 is written against a Python/pytest stack (a known placeholder,
see `docs/REQUIREMENTS.md` contradiction C3) but its underlying principles
apply as-is to this Node/vitest stack:

- **Real database, never mocked.** Every test runs against a real PostgreSQL
  instance and a real Redis instance - no SQLite substitute, no in-memory
  fake, no mocked Prisma client. `TEST_DATABASE_URL` points at a separate
  logical database (`swc_test`) on the same Postgres server as dev, so tests
  never touch dev data.
- **Mock only what crosses a network boundary this project doesn't own.**
  As of Session 7, nothing built yet has such a boundary (no SMS/S3/AI calls
  exist in the implemented modules). When Documents/Reminders/AI land
  (Phases 8-9), their tests should mock the SMS adapter, S3 client, and
  Anthropic API calls specifically - everything else (Postgres, Redis,
  Fastify's own request/response cycle) stays real.
- **Coverage of behaviour, not just lines**, per module: happy path, 401,
  403, 404, 422/400 validation, boundary values, and - critically - the
  object-level authorization case (user A cannot read/write user B's
  patient; a provider without a valid grant is rejected; an expired/revoked
  grant is rejected). See §4 for where each module's suite covers this.
- **Never delete or weaken a test to make a suite green.** No test in this
  project has been skipped, marked `.skip`, or given a trivial always-true
  assertion at any point across Sessions 3-8.
- **Every bug fix ships with a regression test first**, per CLAUDE.md §16.
  Every fix in `docs/FINAL_AUDIT.md` and `docs/PROGRESS.md`'s Session 6/8
  entries has one (e.g. the response-wrapping bug, the `JWT_SECRET`/
  `GRANT_SECRET` startup check, the PIN-login timing side-channel, the
  unbounded grant `ttlMinutes`).

## 2. How to run

```bash
npm run test        # vitest run - the suite, once
npm run test:watch  # vitest - watch mode
npm run coverage     # vitest run --coverage (v8 provider)
npm run check        # format:check && lint && typecheck && test - the full gate
```

Requires a reachable Postgres and Redis matching `DATABASE_URL`/
`TEST_DATABASE_URL`/`REDIS_URL` in `.env` - see `README.md`'s setup section
(the portable, no-Docker path is what every session has actually used so
far; Docker via `docker-compose.yml` is the originally-designed alternative,
never verified end-to-end in this environment).

Coverage target (CLAUDE.md §10): **≥85% on `src/modules/` and `src/plugins/`
(this project's equivalent of `app/services/`/`app/api/`)**. Real numbers
must be run and reported, never estimated - first done in Session 7
(94.66% statements overall; 96-100% per implemented module - see
`docs/PROGRESS.md`'s Session 7 entry for the full breakdown).

## 3. Isolation

Each test file runs against the same real, shared `swc_test` database.
Isolation is **truncate-between-tests**, not per-test transactions:

```ts
// test/helpers/db.ts
await resetDb();    // TRUNCATE every app table, RESTART IDENTITY CASCADE
await resetRedis();  // FLUSHDB
```

called from every suite's `beforeEach`. This is a deliberate, documented
deviation from CLAUDE.md §10's literal "each test runs in a transaction that
rolls back" - this project uses one process-wide Prisma client singleton
(`src/lib/prisma.ts`), so giving each test its own transactional client would
require threading a per-test client through every service function, a much
larger change than any session's scope has justified so far.

**Consequence:** `vitest.config.ts` sets `fileParallelism: false`, so test
*files* run sequentially against the shared database (safe - no file's
`resetDb()` can race another file's assertions) but true parallel/any-order
execution *across files* is not supported, which is a real, unremediated gap
against CLAUDE.md §10's "must pass in any order and in parallel." Tests
*within* a file already share this constraint implicitly, since `beforeEach`
resets shared state before each one regardless of order.

If this project ever needs real cross-file parallelism, the fix is a
per-test Prisma client (or a schema-per-worker strategy), not a change to
this truncate approach itself.

## 4. What each suite covers

| File | Module | Covers |
|---|---|---|
| `test/foundation.test.ts` | Foundation (envelope, health, config) | Error envelope shapes (`AppError`/`ZodError`/generic), health liveness/readiness, config validation failure (incl. the `JWT_SECRET == GRANT_SECRET` startup rejection), request-id header |
| `test/auth.test.ts` | Auth (OTP, PIN, tokens, provider activation) | Full OTP request/verify flow (happy path, rate limit, attempt lockout, expiry, single-use), PIN set/login (happy path, wrong-PIN 401, token-type-confusion 401, 5-fail lockout separate from the 10-req/15min limiter, the PIN-login timing side-channel fix), refresh rotation + reuse-detection, provider/activate (role/invite-code checks), `/me`, a dedicated log-leak assertion (no PIN/OTP/token ever appears in a log line) |
| `test/authz-matrix.test.ts` | Cross-cutting RBAC (`REQ-ROLE-002`) | Every role x every endpoint whose role check is independent of object state (`POST /auth/provider/activate`, `POST /grants/redeem`), generated from one table so a new such endpoint is one array entry, not a new test loop; plus token-type separation (no-token → 401, not 403) |
| `test/patients.test.ts` | Patients | CRUD, idempotent create, owner-only PATCH with version-conflict boundaries, `GET /patients` role-scoping (owned vs. owned-union-granted), the full object-level matrix (owner vs. stranger vs. expired/revoked-grant provider), `record_viewed` audit throttling, an N+1 regression test (`GET /patients` stays ≤2 queries regardless of row count) |
| `test/grants.test.ts` | Access Grants | Full lifecycle (create → redeem → expired → already-redeemed → revoked), the 24h access-window boundary, tampered-signature/unknown-gid rejection, rate limiting, idempotent redeem/revoke, the `ttlMinutes` cap |
| `test/visits.test.ts` | Visits | `canAppendPatient AND role != fchv` (incl. fchv-with-a-valid-grant, read-only-grant, no-grant, expired/revoked-grant), idempotent create (incl. cross-patient id collision), server-filled provider/facility fields, codelist validation (400 with field-level detail for each of complaint/diagnosis/drug), the follow-up reminder's Kathmandu-time math, `visit_added` auditing, list ordering/limit, and a query-count regression test proving code validation doesn't N+1 as `diagnosisCodes`/`prescriptions` grow |

`test/helpers/client.ts` (`asUser`, `testClient`) and `test/helpers/db.ts`
(`resetDb`, `resetRedis`) are shared by every suite above.
`test/helpers/queryCount.ts` (`countQueries`) backs the two N+1 regression
tests (Patients, Visits) - the only place this project's "no N+1 queries"
rule (CLAUDE.md §7) is actually machine-checked rather than asserted by
code review alone.

Modules not yet built (Sync, Maternal, Reminders, Documents, Facilities/code
lists) have no test files yet, by design - `docs/PROJECT_PLAN.md` tracks
`REQ-TEST-001`/`002` (`rules.test.ts`, `sync.test.ts`) as `NOT_STARTED` for
the same reason.
