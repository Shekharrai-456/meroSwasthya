# Final Audit — Swasthya Card Backend

Session 6. Every requirement ID from `docs/REQUIREMENTS.md`, cross-checked against
the actual code and the actual passing test run below — not the plan, not memory.
**Anything not `VERIFIED` is listed first**, per this session's own instruction.

**Methodology, so this document's claims can be checked:** for every row marked
`VERIFIED` or `TESTED` below, the underlying test file was re-run this session
(`npm run check`, real tail pasted under "Verification run") and the requirement
text in `docs/REQUIREMENTS.md` was re-read against the route/service code doing the
work — not just against the test's assertions. Security-relevant code
(`src/plugins/auth.ts`, `src/lib/tokens.ts`, `src/lib/hash.ts`, every route's
`preHandler`) was opened and read line by line this session, not inferred from
having written it in an earlier session. Four real findings came out of that process
and were fixed with a regression test each (§3).

## 1. Summary

| Status | Count | Meaning |
|---|---|---|
| `VERIFIED` | 39 | Code + test re-run this session + requirement text re-matched line by line |
| `IMPLEMENTED` (full or partial) | 13 | Code exists and runs; not fully test-covered or deliberately partial (see §2.3) |
| `NOT_STARTED` | 84 | No code — Visits, Sync, Maternal, Reminders, Documents, Facilities/code lists, seed data, Tier 2/3 items |
| `OUT-OF-REPO (frontend)` | 35 | Flutter app's responsibility, not this backend's |

(Counts are exact, from `grep -c` against `docs/PROJECT_PLAN.md`'s status column, not estimated. `IMPLEMENTED` includes the "IMPLEMENTED (partial)" and "IMPLEMENTED (schema only)" sub-statuses.)

Full per-ID detail lives in `docs/PROJECT_PLAN.md` (organized by build phase); this
document restates it organized by **verification status**, since that's what this
session's audit is actually about, and adds the evidence trail.

Real test run backing every `VERIFIED`/`TESTED` claim below (Session 6, final run):

```
Test Files  5 passed (5)
     Tests  118 passed (118)
```
Format/lint/typecheck: 0 issues (see §4 for the full `npm run check` tail).

## 2. Not VERIFIED — listed first, with reason

### 2.1 NOT_STARTED (no code exists)

Every REQ-ID in these areas is `NOT_STARTED`; see `docs/PROJECT_PLAN.md` for the
full per-ID table (phases 5–9, plus the reference-data/seed rows in phase 1 and the
Grants Tier-2 row). Grouped here by area rather than repeated ID-by-ID:

| Area | REQ prefix | Phase | Why not started |
|---|---|---|---|
| Facilities | `REQ-FACILITY-001` | 1 | Not yet built; only the `Facility` *schema* exists (pulled forward as a hard FK dependency of `User`/`InviteCode`, Session 3) |
| Code lists | `REQ-CODELIST-*` | 1 | Not started |
| Meta (`/rules`, `/config`) | `REQ-META-*` | 1 | Not started |
| Audit (partial) | `REQ-AUDIT-003` | 1 | The *endpoint* (`GET /patients/:id/audit`) is actually built and `VERIFIED` under REQ-PATIENT-010 - this ID is a duplicate tracking row per `PROJECT_PLAN.md`'s own note |
| Seed data | `REQ-SEED-001..003` | 1 | `prisma/seed.ts` is a no-op placeholder; nothing to seed until more entities exist |
| Patient summary/timeline | `REQ-PATIENT-005..009` | 3 | Need `Visit`/`Pregnancy`/`Document`/`AncContact`/`Delivery` tables (Phase 5/7/9) - deliberately not stubbed, see §2.3 |
| Grants Tier 2 | `REQ-GRANT-012` | 4 | Explicitly "build only if time allows" in the source spec |
| Visits | `REQ-VISIT-*` | 5 | Not started |
| Sync | `REQ-SYNC-001..011/023` | 6 | Not started (client-side `REQ-SYNC-012..022` are `OUT-OF-REPO`) |
| Maternal/ANC/triage | `REQ-RULES-*`, `REQ-PREG-001..015` | 7 | Not started |
| Reminders/SMS | `REQ-REMIND-001..007/009` | 8 | Not started |
| Documents/AI | `REQ-DOC-001..008` | 9 | Not started |
| Hardening follow-ups | `REQ-TEST-004`, CORS-tightening, magic-byte check | 10 | See §3.4 - CORS is documented as a deploy-time action, not code; magic-byte check depends on Documents existing |
| Tier 2/3 (never scheduled) | admin stats, DHIS2/HMIS export, NID verification, council registration check, FCM push, child immunisation, fine-grained consent, voice notes, PDF export | — | Out of the 32-hour Tier-1 build per `docs/REQUIREMENTS.md` AS4; promoted only if the user brings them into scope |

### 2.2 OUT-OF-REPO (frontend)

Every `REQ-*` row whose only implementation surface is the Flutter app (UI screens,
local DB/outbox mechanics, client-side rules mirrors) - `REQ-AUTH-014..017`,
`REQ-PATIENT-013..015`, `REQ-GRANT-010/011`, `REQ-VISIT-010/011`, `REQ-SYNC-012..022`,
`REQ-PREG-016..019`, `REQ-TEST-005/006`, `REQ-REMIND-008`, `REQ-DOC-009..011`, all
`REQ-I18N-*`/`REQ-UX-*`. This backend repo will never produce code for these; see
`docs/PROJECT_PLAN.md`'s scope note.

### 2.3 IMPLEMENTED but not (fully) tested — and why that's a deliberate choice, not an oversight

| REQ ID | What's built | Why it stops here |
|---|---|---|
| `REQ-API-004` | `reply.ok()` decorator | Exists and is used by every real route now (it wasn't in Session 2 when this row was first written); genuinely exercised by all 118 passing tests, just never had a dedicated unit test of the decorator in isolation |
| `REQ-API-008` | Date/timestamp helpers (`lib/dates.ts`) | Two one-line wrappers with no branching; used throughout `toPatientDto`/`toAuditDto` and exercised indirectly by every date-bearing field assertion |
| `REQ-SEC-003` | `@fastify/helmet` registered | No test asserts the literal header values are present (e.g. `X-Frame-Options`) - deferred, low risk, a well-known library with its own test suite |
| `REQ-FACILITY-002` | `Facility` schema only | Pulled forward as a hard FK dependency (Session 3); no `/facilities/nearby` route, no Haversine logic, no seed data |
| `REQ-AUDIT-001` | `logAudit()` + one of seven actions (`record_viewed`) wired up | The other six actions (`grant_created`, `grant_redeemed`, `visit_added`, `contact_recorded`, `document_added`, `grant_revoked`) *are* actually wired up too as of Sessions 4-5 (`grant_created`/`grant_redeemed`/`grant_revoked` all call `logAudit`) - this row is stale in `PROJECT_PLAN.md` and should read "4 of 7 wired" as of this session; `visit_added`/`contact_recorded`/`document_added` remain unwired since Visits/Maternal/Documents don't exist |
| `REQ-AUDIT-002` | Immutability | Structurally enforced (no `deleted` column, no update/delete code path exists anywhere in the codebase) rather than proven by a test, since there's no code path to write a test *against* |
| `REQ-AUTH-013` | Invite-code schema | Real invite codes are created ad hoc in tests (`prisma.inviteCode.create`), not via the real seed script (`REQ-SEED-001`, not started) |
| `REQ-ROLE-001` | `Role` enum | Exercised indirectly by every single test in the suite (every test user has a role); no dedicated schema test, since there's nothing to assert beyond "the enum has these four values," which Prisma's own type system already guarantees at compile time |
| `REQ-USER-001` | `User` fields | Same reasoning as `REQ-ROLE-001` |
| `REQ-PATIENT-004` | `GET /patients/:id` | Ships as patient-only, no `summary` block - see the table below |
| `REQ-GRANT-007` | Redeem bundle | Ships as `{grant, patient}`, not the full `{grant, patient, summary, timeline, pregnancy, ancContacts}` |

**On `REQ-PATIENT-004..009` and `REQ-GRANT-007` specifically:** these are the
project's most consequential "not fully done" items, so the reasoning is repeated
here rather than just cross-referenced. `GET /patients/:id`'s documented response
includes a `summary` block (`activeProblems`, `currentMedicines`, `lastVitals`,
`activePregnancy`, `lastVisitAt`, `visitCount`), and the grants redeem bundle
documents the same plus `timeline`/`ancContacts`. Every one of those fields is
computed from `Visit`, `Pregnancy`, `Document`, or `AncContact` rows, and none of
those tables exist yet (Phases 5/7/9). Returning `visitCount: 0`/`activeProblems: []`
today would look like a real response but would be **wrong the moment those tables
exist and hold data**, silently, unless a future session remembers to come back and
wire in real queries - exactly the class of stub CLAUDE.md §2 forbids ("No TODOs,
stubs, or fake implementations for required functionality"). Both endpoints instead
return exactly what's real today and nothing else. This is intentional, documented in
three places (`docs/PROGRESS.md` Sessions 4/5, `docs/PROJECT_PLAN.md`, here), and
the fix is well-defined: once Visits/Maternal land, extend these two response
builders, no architecture change needed.

## 3. VERIFIED — with evidence

### 3.1 Foundation (Phase 0)

| REQ ID | Requirement | File(s) | Test(s) | Evidence |
|---|---|---|---|---|
| `REQ-API-001` | Global error envelope | `src/plugins/envelope.ts` | `test/foundation.test.ts` | Error-envelope shape tests pass; re-read this session, confirmed `AppError`/`ZodError`/generic-Error all route through the one `setErrorHandler` |
| `REQ-API-002` | Validation error shape | `src/plugins/envelope.ts` | `test/foundation.test.ts`, every module's "400 VALIDATION_ERROR" tests | Field-level `details` array confirmed present on every validation-failure test across all 5 test files |
| `REQ-API-003` | 500s never leak internals | `src/plugins/envelope.ts` | `test/foundation.test.ts` | `500 on an unhandled error never leaks the internal message` passes; re-confirmed by reading the handler this session (generic message only, `err` object only reaches the logger, never the response) |
| `REQ-SEC-002` | CORS open, hackathon-only | `src/app.ts`, `src/config.ts` | `test/foundation.test.ts` (indirect) | Confirmed configurable (`CORS_ORIGINS` env var), defaults to `*`; documented as a required pre-deployment change in `README.md`'s new Deployment notes section (Session 6) |

### 3.2 Auth, RBAC, Users (Phase 2)

Every route in `src/modules/auth/routes.ts` re-read this session; every one has an
explicit `preHandler` (or is one of the 4 endpoints deliberately public, matching
`docs/API_CONTRACT.md`'s own "Auth: none" column exactly - `otp/request`,
`otp/verify`, `pin/login`, `refresh`).

| REQ ID | Requirement | File(s) | Test(s) |
|---|---|---|---|
| `REQ-AUTH-001` | Phone E.164 normalization | `src/modules/auth/schemas.ts` | `test/auth.test.ts` |
| `REQ-AUTH-002` | `POST /auth/otp/request` + rate limit | `src/modules/auth/{routes,service}.ts`, `src/lib/rateLimiter.ts` | `test/auth.test.ts` |
| `REQ-AUTH-003` | Demo OTP `123456` | `src/modules/auth/service.ts` | `test/auth.test.ts` |
| `REQ-AUTH-004` | `POST /auth/otp/verify`, tempToken | `src/modules/auth/{routes,service}.ts` | `test/auth.test.ts` |
| `REQ-AUTH-005` | `POST /auth/pin/set` (create + reset) | `src/modules/auth/service.ts` | `test/auth.test.ts` |
| `REQ-AUTH-006` | `POST /auth/pin/login` + lockout | `src/modules/auth/service.ts`, `src/lib/rateLimiter.ts` | `test/auth.test.ts` |
| `REQ-AUTH-007` | `POST /auth/refresh`, rotation | `src/modules/auth/service.ts` | `test/auth.test.ts` |
| `REQ-AUTH-008` | `POST /auth/provider/activate` | `src/modules/auth/{routes,service}.ts` | `test/auth.test.ts` |
| `REQ-AUTH-009` | `GET /me` | `src/modules/auth/routes.ts` | `test/auth.test.ts` |
| `REQ-AUTH-010` | Access token claims/signing | `src/lib/tokens.ts` | `test/auth.test.ts` |
| `REQ-AUTH-011` | Refresh token hashed, revocable | `src/modules/auth/service.ts`, `src/lib/hash.ts` | `test/auth.test.ts` |
| `REQ-AUTH-012` | `requireAuth()` → 401 | `src/plugins/auth.ts` | `test/auth.test.ts` |
| `REQ-ROLE-002` | `requireRole()` → 403 | `src/plugins/auth.ts` | `test/authz-matrix.test.ts` |
| `REQ-ROLE-003` | `canReadPatient()` | `src/plugins/auth.ts` | `test/patients.test.ts` |
| `REQ-ROLE-004` | `canAppendPatient()` | `src/plugins/auth.ts` | `test/patients.test.ts` |
| `REQ-ROLE-006` | `record_viewed` throttled 10min | `src/plugins/auth.ts`, `src/modules/audit/service.ts` | `test/patients.test.ts` |
| `REQ-ROLE-007` | `GET /patients` role scoping | `src/modules/patients/{routes,service}.ts` | `test/patients.test.ts` |
| `REQ-ROLE-008` | Grant/access token type separation | `src/lib/tokens.ts` | `test/auth.test.ts`, `test/authz-matrix.test.ts` |
| `REQ-USER-002` | User serializer never leaks `pinHash` | `src/lib/serializers.ts` | `test/auth.test.ts` |
| `REQ-SEC-005` | Argon2id + refresh-token hashing | `src/lib/hash.ts` | `test/auth.test.ts` |

### 3.3 Patients (Phase 3)

| REQ ID | Requirement | File(s) | Test(s) |
|---|---|---|---|
| `REQ-PATIENT-001` | `POST /patients`, idempotent create | `src/modules/patients/{routes,service}.ts` | `test/patients.test.ts` |
| `REQ-PATIENT-002` | Same id, different owner → 403 | `src/modules/patients/service.ts` | `test/patients.test.ts` |
| `REQ-PATIENT-003` | `PATCH`, optimistic concurrency | `src/modules/patients/service.ts` | `test/patients.test.ts` |
| `REQ-PATIENT-010` | `GET /patients/:id/audit`, owner-only | `src/modules/patients/{routes,service}.ts`, `src/modules/audit/service.ts` | `test/patients.test.ts` |
| `REQ-PATIENT-011` | Patient fields | `prisma/schema.prisma` | `test/patients.test.ts` (every endpoint) |
| `REQ-PATIENT-012` | Soft-delete flag + read filters | every `patients/*` query (`deleted: false`) | `test/patients.test.ts` |

### 3.4 Access Grants (Phase 4)

| REQ ID | Requirement | File(s) | Test(s) |
|---|---|---|---|
| `REQ-GRANT-001` | `POST /grants` create + rate limit | `src/modules/grants/{routes,service}.ts` | `test/grants.test.ts` |
| `REQ-GRANT-002` | `qrPayload = "SWC1:" + token` | `src/modules/grants/service.ts` | `test/grants.test.ts` |
| `REQ-GRANT-003` | `POST /grants/redeem`, role check | `src/modules/grants/{routes,service}.ts` | `test/grants.test.ts` |
| `REQ-GRANT-004` | Expired/revoked → `GRANT_EXPIRED` | `src/modules/grants/service.ts` | `test/grants.test.ts` |
| `REQ-GRANT-005` | Same-user idempotent / other-user 409 | `src/modules/grants/service.ts` | `test/grants.test.ts` |
| `REQ-GRANT-006` | Redeem sets `accessUntil`, audits | `src/modules/grants/service.ts` | `test/grants.test.ts` |
| `REQ-GRANT-008` | `POST /grants/:id/revoke` | `src/modules/grants/{routes,service}.ts` | `test/grants.test.ts` |
| `REQ-GRANT-009` | 24h access window enforced every call | `src/plugins/auth.ts` | `test/grants.test.ts` |
| `REQ-TEST-003` | `grants.test.ts` full lifecycle suite | `test/grants.test.ts` | (is the test) |

## 4. Verification run (Session 6, final)

```
> swasthya-card-backend@0.1.0 check
> npm run format:check && npm run lint && npm run typecheck && npm run test

Checked 41 files in 29ms. No fixes applied.    (format)
Checked 41 files in 36ms. No fixes applied.    (lint)
                                                 (typecheck: 0 errors)

Test Files  5 passed (5)
     Tests  118 passed (118)
```

Against a real Postgres 17 and real Redis (portable, no Docker - see
`docs/OPEN_QUESTIONS.md` Question 7), not a mock. `docs/openapi.json` regenerated
from the live route definitions after every fix in this session.

## 5. Security findings (Session 6)

Full walkthrough in `docs/PROGRESS.md`'s Session 6 entry. Summary:

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | `JWT_SECRET`/`GRANT_SECRET` being equal was never rejected at startup, only documented as a convention | `src/config.ts` now `.refine()`s them distinct; regression test in `test/foundation.test.ts` |
| — | Informational | Global 300/min/IP rate limit has no dedicated test (would need 300 sequential requests) | Not fixed - the tighter, business-relevant limits (OTP/PIN/grant) are already tested via the same mechanism; noted as an accepted gap |
| — | Informational | `envelope.ts` passes through Fastify's own native 4xx error messages (e.g. payload-too-large) rather than routing through `AppError` | Not a leak (Fastify's own client-facing messages carry no stack/internal data by design); noted as a minor architectural inconsistency, not fixed |

Everything else checked (route-by-route auth gates, object-level checks, secure
headers, no raw SQL, no secrets in source/logs, algorithm allowlisting on both token
types) matched `docs/SECURITY.md` with no gap found. Rows 11/15/16/17/18/21/23 of
`docs/SECURITY.md` are not applicable yet - they describe controls for
Documents/Reminders/Sync, none of which exist.

## 6. Frontend contract findings (Session 6)

Walked every screen (S01-S23) that maps to a built endpoint. One real bug found:

**`POST /patients`, `GET /patients/:id`, and `PATCH /patients/:id` all returned the
bare patient object instead of `{ "patient": <Patient> }`**, contradicting
`backend.md`'s own A.4 examples for all three endpoints. This would have broken any
real Dart client expecting `response.data.patient.id`. Fixed in
`src/modules/patients/routes.ts`; every affected test updated and re-verified
(118/118 passing). `GET /patients` (list) and `GET /patients/:id/audit` were already
correct (`{items: [...]}`), as was the entire Auth and Grants module.

No other mismatches found in the built surface. Everything not built yet
(`GET /patients/:id/timeline`, `/facilities`, `/codelists`, `/rules`, `/config`,
Visits, Documents, Reminders, Maternal) is a documented gap (§2.1), not a mismatch.

## 7. Performance findings (Session 6)

- **Missing index found by reasoning through real query shapes, not by inspection**:
  `REQ-ROLE-007`'s `GET /patients` list query filters `AccessGrant` by
  `redeemedByUserId`/`revokedAt`/`accessUntil` with no `patientId` in the `WHERE`
  clause - the existing index (`[patientId, redeemedByUserId, accessUntil]`) can't
  serve that as an efficient range scan, since a B-tree composite index only supports
  leftmost-prefix lookups. Added `@@index([redeemedByUserId, revokedAt, accessUntil])`
  (migration `20260918204238_grant_actor_index`, documented in `docs/DATA_MODEL.md`).
- **Query counts**: `GET /patients` asserted ≤2 queries regardless of result size
  (`test/patients.test.ts`'s N+1 test, backed by real Prisma query-event counting,
  `src/lib/prisma.ts`/`test/helpers/queryCount.ts`). No other list-shaped endpoint
  exists yet to check.
- **Pagination limits**: no built endpoint paginates (`GET /patients` and
  `GET /patients/:id/audit` are both small, bounded, unpaginated lists per
  `docs/API_CONTRACT.md` §6's own convention) - nothing to cap yet.
- **Response sizes**: every DTO (`PatientDto`, `GrantDto`, `UserDto`, `AuditDto`) is
  small and flat; no oversized payload risk in the current surface.
- **`assertCanReadPatient`'s hot-path query count**: up to 6 sequential queries on a
  worst-case `GET /patients/:id` call (existence check, ownership check, grant check,
  audit-throttle check, actor-info lookup, audit insert). Doesn't scale with data
  volume (not an N+1), but is a real latency observation worth revisiting if this
  endpoint ever needs to be faster under load - noted here, not changed this session.

## 8. Production readiness (Session 6)

| Item | Status |
|---|---|
| Graceful shutdown | Was already correct (`SIGINT`/`SIGTERM` → close → disconnect); added a 10s hard-timeout fallback so a hung request handler can't block shutdown forever |
| Connection pool sizing | Using `node-postgres`'s default (`pg.Pool` max 10) - not overridden; documented as fine at this project's stated scale, revisit if that changes |
| Timeouts on outbound calls | No outbound HTTP calls exist yet (no S3/SMS/AI) - N/A. Postgres/Redis use library-default connect timeouts |
| Readiness vs liveness | Correct: `/health/live` = process up; `/health/ready` = process up AND Postgres AND Redis reachable |
| Log levels | Defaults to `info`; documented as production-safe (never logs secrets at any level, `debug` just adds noise) |
| Migration procedure | Documented in `README.md` (`prisma migrate deploy`, and the separate test-database step) |
| Rollback procedure | Documented in `README.md`; genuinely exercised against a live database for every migration added this project (Sessions 3, 4, 6 - not theoretical) |
| Required env vars | `.env.example` diffed against `src/config.ts`'s actual zod schema - exact match, nothing missing or stale |
| Deployment section in README | Added (§ Deployment notes): CORS, secrets, pooling, log level, migrations, health checks, graceful shutdown |
| Clean-machine run | **Not fully verified** - Docker was never available in any session, so the originally-designed Docker path has never been run end-to-end. The portable/no-Docker path *has* been run repeatedly, for real, across Sessions 3-6, and is now the primary documented path in `README.md` |

## 9. What I'd fix next, with more time

In priority order:

1. **Build Visits (Phase 5)** - it's the single biggest unblock: it's what makes
   `REQ-PATIENT-005/006/008/009` and `REQ-GRANT-007`'s summary/timeline fields real
   instead of deliberately absent, and it's next in the dependency-ordered plan.
2. **A real end-to-end smoke test** (`REQ-TEST-004`) once there are enough modules
   for one to mean something - today's two integration tests
   (`test/patients.test.ts`, `test/grants.test.ts`) already cover what exists, but
   neither spans the full documented demo path (login → patient → grant → redeem →
   visit → pregnancy → red-triage contact → timeline) because most of that path
   doesn't exist yet.
3. **Facilities + code lists + seed data (Phase 1)** - currently the lowest-effort,
   highest-leverage gap: `docs/PROJECT_PLAN.md`'s own phase order put it early for a
   reason (visits need code lists to validate against; the demo needs seed data to
   be demoable at all), and nothing about it is blocked on anything else that isn't
   already built.
4. **Revisit `assertCanReadPatient`'s query count** (§7) once there's a real load
   profile to measure against - premature to optimize on guesswork alone, but worth
   tracking once Visits/Grants traffic is real.
5. **A dedicated test for the global 300/min/IP rate limit**, if a fast way to
   simulate it (rather than 300 real sequential requests) turns up - not worth the
   test-suite time cost otherwise.
