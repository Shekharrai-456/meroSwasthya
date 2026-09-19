# Final Audit — Swasthya Card Backend

Originally Session 6; re-run and extended in **Session 8** to cover Visits
(Phase 5, built in Session 7) and a fresh security/contract/performance pass
against everything built so far. Every requirement ID from
`docs/REQUIREMENTS.md`, cross-checked against the actual code and the actual
passing test run below — not the plan, not memory. **Anything not `VERIFIED`
is listed first**, per this document's original instruction.

**Methodology, so this document's claims can be checked:** for every row marked
`VERIFIED` below, the underlying test file was re-run this session
(`npm run check`, real tail pasted under "Verification run") and the requirement
text in `docs/REQUIREMENTS.md` was re-read against the route/service code doing the
work — not just against the test's assertions. Security-relevant code
(`src/plugins/auth.ts`, `src/lib/tokens.ts`, `src/lib/hash.ts`, `src/modules/visits/*`,
every route's `preHandler`) was opened and read line by line this session. Three
real findings came out of that process this session and were fixed with a
regression test each (§5, §7) — on top of the four found in Session 6.

## 1. Summary

| Status | Count | Meaning |
|---|---|---|
| `VERIFIED` | 47 | Code + test re-run this session + requirement text re-matched line by line |
| `IMPLEMENTED` (full, partial, or schema-only) | 16 | Code exists and runs; not fully test-covered or deliberately partial (see §2.3) |
| `NOT_STARTED` | 70 | No code — Sync, Maternal, Reminders, Documents, Facilities/code-list routes, most seed data, Tier 2/3 items |
| `OUT-OF-REPO (frontend)` | 32 | Flutter app's responsibility, not this backend's |

(Counts are exact, from a fresh `grep` against `docs/PROJECT_PLAN.md`'s status
column this session - all 165 requirement rows accounted for. `IMPLEMENTED`
includes the "IMPLEMENTED (partial)" and "IMPLEMENTED (schema only)"
sub-statuses. Session 6's original counts, for comparison: 39/13/84/35 -
the shift reflects Visits landing in Session 7 plus this session's own
`CodeListItem`/`REQ-SEED-003` pull-forward.)

Full per-ID detail lives in `docs/PROJECT_PLAN.md` (organized by build phase); this
document restates it organized by **verification status**, since that's what this
session's audit is actually about, and adds the evidence trail.

Real test run backing every `VERIFIED` claim below (Session 8, final run):

```
Test Files  6 passed (6)
     Tests  150 passed (150)
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
| Code lists (route) | `REQ-CODELIST-001` | 1 | `GET /codelists` not built; the `CodeListItem` *schema* and a partial seed exist (pulled forward in Session 7 as a hard dependency of Visits - see `REQ-CODELIST-002`/`REQ-SEED-003` in §2.3) |
| Meta (`/rules`, `/config`) | `REQ-META-*` | 1 | Not started |
| Audit (partial) | `REQ-AUDIT-003` | 1 | The *endpoint* (`GET /patients/:id/audit`) is actually built and `VERIFIED` under REQ-PATIENT-010 - this ID is a duplicate tracking row per `PROJECT_PLAN.md`'s own note |
| Seed data (rest) | `REQ-SEED-001/002` | 1 | Facilities/invites/demo users/patients/visits/pregnancy seed still a no-op; `REQ-SEED-003` (code lists) is now partially done, see §2.3 |
| Patient summary/timeline | `REQ-PATIENT-005..009` | 3 | Need `Pregnancy`/`Document`/`AncContact`/`Delivery` tables too (Phase 7/9), not just `Visit` (now built) - deliberately not stubbed, see §2.3 |
| Grants Tier 2 | `REQ-GRANT-012` | 4 | Explicitly "build only if time allows" in the source spec |
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
| `REQ-AUDIT-001` | `logAudit()` + five of seven actions wired up | `record_viewed` (Session 4), `grant_created`/`grant_redeemed`/`grant_revoked` (Session 5), `visit_added` (Session 7). `contact_recorded`/`document_added` remain unwired since Maternal/Documents don't exist |
| `REQ-AUDIT-002` | Immutability | Structurally enforced (no `deleted` column, no update/delete code path exists anywhere in the codebase) rather than proven by a test, since there's no code path to write a test *against* |
| `REQ-AUTH-013` | Invite-code schema | Real invite codes are created ad hoc in tests (`prisma.inviteCode.create`), not via the real seed script (`REQ-SEED-001`, not started) |
| `REQ-ROLE-001` | `Role` enum | Exercised indirectly by every single test in the suite (every test user has a role); no dedicated schema test, since there's nothing to assert beyond "the enum has these four values," which Prisma's own type system already guarantees at compile time |
| `REQ-USER-001` | `User` fields | Same reasoning as `REQ-ROLE-001` |
| `REQ-PATIENT-004` | `GET /patients/:id` | Ships as patient-only, no `summary` block - see the table below |
| `REQ-GRANT-007` | Redeem bundle | Ships as `{grant, patient}`, not the full `{grant, patient, summary, timeline, pregnancy, ancContacts}` |
| `REQ-CODELIST-002` | `CodeListItem` schema only | Pulled forward in Session 7 as a hard dependency of `REQ-VISIT-004`; no `/codelists` route |
| `REQ-SEED-003` | Partial codelist seed | Session 7 seeded 17 complaints/18 diagnoses/19 drugs (real codes, real EN/NP labels) - short of the full 40/60/50 curated demo target, a content-authoring task independent of any module's logic |
| `REQ-VISIT-008` | Append-only, `supersedesId` | Structurally enforced (no update/delete route exists for `Visit` at all, same as `REQ-AUDIT-002`'s precedent) - no dedicated test since there's no mutation path to test against |

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

### 3.5 Visits (Phase 5, Session 7 - re-verified this session)

| REQ ID | Requirement | File(s) | Test(s) |
|---|---|---|---|
| `REQ-VISIT-001` | `POST /patients/:id/visits`, `canAppendPatient AND role != fchv` | `src/modules/visits/{routes,service}.ts` | `test/visits.test.ts` |
| `REQ-VISIT-002` | Idempotent on client-generated id | `src/modules/visits/service.ts` | `test/visits.test.ts` |
| `REQ-VISIT-003` | Server-filled provider/facility fields | `src/modules/visits/service.ts` | `test/visits.test.ts` |
| `REQ-VISIT-004` | Codes validated against `CodeListItem` | `src/modules/visits/service.ts` | `test/visits.test.ts` |
| `REQ-VISIT-005` | `follow_up` Reminder created | `src/modules/visits/service.ts`, `src/lib/dates.ts` (`kathmanduNineAm`) | `test/visits.test.ts` |
| `REQ-VISIT-006` | `visit_added` audited | `src/modules/visits/service.ts` | `test/visits.test.ts` |
| `REQ-VISIT-007` | `GET /patients/:id/visits`, newest-first | `src/modules/visits/{routes,service}.ts` | `test/visits.test.ts` |
| `REQ-VISIT-009` | Embedded vitals/diagnoses/prescriptions | `prisma/schema.prisma`, `src/lib/serializers.ts` | `test/visits.test.ts` |

## 4. Verification run (Session 8, final)

```
> swasthya-card-backend@0.1.0 check
> npm run format:check && npm run lint && npm run typecheck && npm run test

Checked 46 files in 35ms. No fixes applied.    (format)
Checked 46 files in 41ms. No fixes applied.    (lint)
                                                 (typecheck: 0 errors)

Test Files  6 passed (6)
     Tests  150 passed (150)
```

Real coverage (`npm run coverage`, v8 provider), run and logged for the first
time in Session 7 and re-confirmed this session: **94%+ statements overall,
96-100% on every implemented `src/modules/*` service** - see
`docs/PROGRESS.md`'s Session 7/8 entries for the exact per-module numbers.

Against a real Postgres 17 and real Redis (portable, no Docker - see
`docs/OPEN_QUESTIONS.md` Question 7), not a mock. `docs/openapi.json` regenerated
from the live route definitions after every fix in this session.

## 5. Security findings

### Session 8 (this session, covering Auth/Patients/Grants/Visits)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Low-Medium | `POST /grants`'s `ttlMinutes` had no upper bound - a caller could mint an ordinary (no-PIN-at-redeem) grant valid for months/years, functionally REQ-GRANT-012's Tier-2 long-lived QR without its required extra safeguard | Capped at 60 minutes (`src/modules/grants/schemas.ts`'s `GRANT_TTL_MINUTES_MAX`); regression tests in `test/grants.test.ts` (rejects 61, accepts 60) |
| 2 | Low | `loginWithPin` timing side-channel: a nonexistent phone / user with no `pinHash` short-circuited before ever running argon2, responding measurably faster than a wrong-PIN attempt on a real account - the identical error message alone didn't close the user-enumeration defense this row's own comment already claimed, only its timing did | `verifyPin` now always runs (against the real hash, or a precomputed `DUMMY_PIN_HASH` when there is none) before responding either way; timing-comparison regression test in `test/auth.test.ts` |
| 3 | None (test-coverage gap, not a vulnerability) | `test/authz-matrix.test.ts`'s own header comment asks each session to append its `requireRole`-gated endpoints there; Grants (Session 5) never had, so `admin` was never asserted forbidden on `POST /grants/redeem` | Added the `POST /grants/redeem` case to the matrix (mints a real, fresh grant per role tested); all 4 roles now asserted correctly |

Everything else re-checked this session (route-by-route auth gates on
`src/modules/visits/*`, object-level checks reused unchanged from `plugins/auth.ts`,
no raw SQL, no secrets in Visits' log paths, code-validation query batching)
matched `docs/SECURITY.md` with no further gap found.

### Session 6 (original, covering Foundation/Auth/Patients/Grants)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Medium | `JWT_SECRET`/`GRANT_SECRET` being equal was never rejected at startup, only documented as a convention | `src/config.ts` now `.refine()`s them distinct; regression test in `test/foundation.test.ts` |
| — | Informational | Global 300/min/IP rate limit has no dedicated test (would need 300 sequential requests) | Not fixed - the tighter, business-relevant limits (OTP/PIN/grant) are already tested via the same mechanism; noted as an accepted gap |
| — | Informational | `envelope.ts` passes through Fastify's own native 4xx error messages (e.g. payload-too-large) rather than routing through `AppError` | Not a leak (Fastify's own client-facing messages carry no stack/internal data by design); noted as a minor architectural inconsistency, not fixed |

Rows 11/15/16/17/18/21/23 of `docs/SECURITY.md` remain not applicable yet -
they describe controls for Documents/Reminders/Sync, none of which exist.

## 6. Frontend contract findings

### Session 8: Visits (S22)

Walked S22 ("Add visit") against what's built: chief-complaint picklist,
numeric vitals, multi-select diagnoses, medicine rows with the exact
`OD`/`BD`/`TDS`/`QID`/`SOS`/`HS` frequency set, advice, follow-up date,
referral toggle (`facilityId?`/`facilityName`/`reason`/`urgency`) - every
field in `POST /patients/:id/visits`'s request/response shape matches Part
A.2's `Visit`/`Prescription` entities exactly. S22's role note ("fchv:
read-only, cannot prescribe") is the already-known, already-resolved
Contradiction C1 (`docs/REQUIREMENTS.md`) - Question 1's resolution (Option
A: fchv never reaches this screen at all) is what got built, matching the
backend's three-times-stated hard block. No new mismatch found.

### Session 6: everything built at the time

Walked every screen (S01-S23) that maps to a built endpoint. One real bug found:

**`POST /patients`, `GET /patients/:id`, and `PATCH /patients/:id` all returned the
bare patient object instead of `{ "patient": <Patient> }`**, contradicting
`backend.md`'s own A.4 examples for all three endpoints. This would have broken any
real Dart client expecting `response.data.patient.id`. Fixed in
`src/modules/patients/routes.ts`; every affected test updated and re-verified.
`GET /patients` (list) and `GET /patients/:id/audit` were already
correct (`{items: [...]}`), as was the entire Auth and Grants module.

No other mismatches found in the built surface. Everything not built yet
(`GET /patients/:id/timeline`, `/facilities`, `/codelists`, `/rules`, `/config`,
Sync, Documents, Reminders, Maternal) is a documented gap (§2.1), not a mismatch.

## 7. Performance findings

### Session 8

- **Redundant query eliminated**: `visits/service.ts`'s `createVisit` called
  `getActorAuditInfo` (a real DB query) up to twice per request - once inside
  provider-info resolution (for a non-owner actor), once more, unconditionally,
  for the audit-log write. Refactored to fetch it exactly once and reuse the
  result for both, halving that query in the worst case with no behavior change.
- **N+1 checked and proven absent**: `assertCodesExist` batches every
  complaint/diagnosis/drug code on a visit into one `codeListItem.findMany`
  regardless of how many `diagnosisCodes`/`prescriptions` are submitted -
  proven by a new query-count regression test (`test/visits.test.ts`) asserting
  identical query counts for a 1-code and a 6-code visit.
- **Pagination limit**: `GET /patients/:id/visits`'s `limit` query param is
  capped at 200 (schema-level `z.number().max(200)`), defaulting to the
  documented 50 - the first built list endpoint with a client-suppliable
  limit, so the first place this needed an explicit cap.
- **Response sizes**: `VisitDto` is flat, includes embedded (small)
  `prescriptions[]`; no oversized payload risk.
- **`assertCanReadPatient`/`assertCanAppendPatient`'s per-request query count**
  (Session 6's original finding, up to 6 sequential queries in
  `GET /patients/:id`'s worst case) is unchanged and now also the shape
  `createVisit` inherits - still not an N+1 (doesn't scale with data volume),
  still not revisited this session, same reasoning as Session 6.

### Session 6 (original)

- **Missing index found by reasoning through real query shapes, not by inspection**:
  `REQ-ROLE-007`'s `GET /patients` list query filters `AccessGrant` by
  `redeemedByUserId`/`revokedAt`/`accessUntil` with no `patientId` in the `WHERE`
  clause - the existing index (`[patientId, redeemedByUserId, accessUntil]`) can't
  serve that as an efficient range scan, since a B-tree composite index only supports
  leftmost-prefix lookups. Added `@@index([redeemedByUserId, revokedAt, accessUntil])`
  (migration `20260918204238_grant_actor_index`, documented in `docs/DATA_MODEL.md`).
- **Query counts**: `GET /patients` asserted ≤2 queries regardless of result size
  (`test/patients.test.ts`'s N+1 test, backed by real Prisma query-event counting,
  `src/lib/prisma.ts`/`test/helpers/queryCount.ts`).

## 8. Production readiness (Session 6, re-confirmed unchanged in Session 8)

Visits introduced no new outbound calls, timeouts, or infrastructure surface -
nothing in this section changed this session.

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

In priority order (superseding Session 6's list, which was scoped to what
existed before Visits):

1. **Build Sync (Phase 6)** - next in the dependency-ordered plan, and what
   the offline-first client architecture actually needs to function at all.
2. **Facilities + code lists route + rest of seed data (Phase 1)** - the
   `CodeListItem` schema and a partial seed exist now (pulled forward for
   Visits), but `GET /facilities/nearby`, `GET /codelists`, and
   `REQ-SEED-001/002` (facilities/invites/demo users/patients) are still
   entirely unbuilt, and the demo needs all of it to be demoable at all.
3. **Finish the codelist seed to REQ-SEED-003's full 40/60/50 target** -
   a content-authoring task, not a logic gap; today's 17/18/19 real codes are
   enough to exercise and demo Visits but not the full curated list.
4. **A real end-to-end smoke test** (`REQ-TEST-004`) once there are enough
   modules for one to mean something - today's three integration tests
   (`test/patients.test.ts`, `test/grants.test.ts`, `test/visits.test.ts`)
   already cover what exists, but neither spans the full documented demo path
   (login → patient → grant → redeem → visit → pregnancy → red-triage
   contact → timeline) because most of that path doesn't exist yet.
5. **Revisit `assertCanReadPatient`/`assertCanAppendPatient`'s query count**
   (§7) once there's a real load profile to measure against - premature to
   optimize on guesswork alone, but worth tracking as Visits/Grants traffic
   grows on top of it.
6. **A dedicated test for the global 300/min/IP rate limit**, if a fast way to
   simulate it (rather than 300 real sequential requests) turns up - not worth
   the test-suite time cost otherwise.
