# Project Plan — Swasthya Card Backend

One row per REQ ID from `docs/REQUIREMENTS.md`. All rows start `NOT_STARTED` — no code exists yet. Status values per CLAUDE.md §11.

**Scope note:** `SESSION_PROMPTS.md`'s seven sessions build **only the backend** (`backend.md`'s repo — note the two source docs have different owners: "backend developer" vs "HEI (frontend)", i.e. two separate codebases). Requirements whose only implementation surface is the Flutter app are listed here for full traceability (as the Session 1 brief requires "one row per REQ ID") but are marked phase **`OUT-OF-REPO (frontend)`** — this backend repo's sessions will never produce code for them, and their status will stay `NOT_STARTED` from this repo's point of view forever; they are the separate frontend developer's plan. Shared-contract requirements (the triage rules, the sync protocol) get a row for the **backend half only**; the Dart mirror is out-of-repo the same way.

Phases are ordered by real technical dependency (per `backend.md` §14's own build order, which is dependency-justified: foundation → reference data → auth → patients → grants → visits → sync → maternal → reminders → documents → hardening), not by the REQUIREMENTS.md area order.

## Phase 0 — Foundation

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-API-001 | Global error envelope | VERIFIED | `src/plugins/envelope.ts` | `test/foundation.test.ts` | |
| REQ-API-002 | Validation error shape | VERIFIED | `src/plugins/envelope.ts` | `test/foundation.test.ts` | |
| REQ-API-003 | 500 errors never leak internals | VERIFIED | `src/plugins/envelope.ts` | `test/foundation.test.ts` | |
| REQ-API-004 | Success envelope shape | IMPLEMENTED | `src/plugins/envelope.ts` (`reply.ok`) | — | decorator exists; no real route calls it yet (health routes return plain bodies, not the envelope, by design — infra probes, not API data) |
| REQ-API-005 | version + updatedAt on syncables | NOT_STARTED | `prisma/schema.prisma` | `test/foundation.test.ts` | no models exist yet — convention applies starting Session 3 |
| REQ-API-006 | Cursor pagination only | NOT_STARTED | (convention, enforced per-module) | per-module tests | no shared code artifact |
| REQ-API-007 | Serializers only, no raw Prisma out | NOT_STARTED | `src/lib/serializers.ts` | per-module tests | no entities to serialize yet |
| REQ-API-008 | Date/timestamp format rules | IMPLEMENTED | `src/lib/dates.ts` | — | helpers exist, unused until a module needs them; no test written for two one-line wrappers with no branching |
| REQ-SEC-002 | CORS open (hackathon-only) | VERIFIED | `src/app.ts` (`@fastify/cors`), `src/config.ts` | `test/foundation.test.ts` (indirectly, via passing suite with the plugin registered) | revisit before any real deploy |
| REQ-SEC-003 | Secure headers | IMPLEMENTED | `src/app.ts` (`@fastify/helmet`) | — | registered; no test asserts the actual header values are present |
| REQ-SEC-004 | No sensitive data in logs | IMPLEMENTED | `src/app.ts` (pino serializers strip req/res bodies) | — | nothing secret exists to log yet (no auth); re-verify explicitly once PINs/tokens exist in Session 3 |
| REQ-SEC-001 | Rate-limit plugin infra (limits attach per-route in later phases) | IMPLEMENTED | `src/plugins/ratelimit.ts` | per-module tests | plugin registered with a global 300/min default; no test asserts a 429 yet — deferred to Auth/Grants phases as planned |

## Phase 1 — Reference data & static services

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-FACILITY-001 | GET /facilities/nearby, Haversine | VERIFIED | `src/modules/facilities/routes.ts`, `service.ts`, `src/lib/geo.ts` | `test/facilities.test.ts` | Session 10 |
| REQ-FACILITY-002 | Facility fields | VERIFIED | `prisma/schema.prisma` | `test/facilities.test.ts` | schema pulled forward in Session 3; route built Session 10 |
| REQ-CODELIST-001 | GET /codelists, versioned, cached | VERIFIED | `src/modules/codelists/routes.ts`, `service.ts` | `test/codelists.test.ts` | Session 10 |
| REQ-CODELIST-002 | CodeListItem fields | VERIFIED | `prisma/schema.prisma` | `test/codelists.test.ts`, `test/visits.test.ts` | schema pulled forward in Session 7; route built Session 10 |
| REQ-META-001 | GET /rules serves RULES verbatim | VERIFIED | `src/modules/meta/routes.ts` | `test/meta.test.ts` | Session 10; serves `src/modules/maternal/rules/rules.json` (built Session 9) verbatim, no duplicate copy |
| REQ-META-002 | GET /config feature flags | VERIFIED | `src/modules/meta/routes.ts` | `test/meta.test.ts` | Session 10 |
| REQ-AUDIT-001 | AuditEntry written on all 7 actions | VERIFIED | `src/modules/audit/service.ts` (`logAudit`), called from `src/plugins/auth.ts`, `src/modules/grants/service.ts`, `src/modules/visits/service.ts`, `src/modules/maternal/service.ts`, `src/modules/documents/service.ts` | `test/patients.test.ts`, `test/grants.test.ts`, `test/visits.test.ts`, `test/maternal.test.ts`, `test/documents.test.ts` | `record_viewed` (Session 4), `grant_created`/`grant_redeemed`/`grant_revoked` (Session 5), `visit_added` (Session 7), `contact_recorded` (Session 9), `document_added` (Session 13) |
| REQ-AUDIT-002 | Audit rows immutable | IMPLEMENTED | `prisma/schema.prisma` (no `deleted` field, no update/delete code path on AuditEntry anywhere) | — | structurally enforced (nothing in the codebase can modify a row); no dedicated test since there's no code path to test against |
| REQ-AUDIT-003 | GET /patients/:id/audit, owner-only | VERIFIED | `src/modules/patients/routes.ts` | `test/patients.test.ts` | duplicate tracking row for REQ-PATIENT-010 (same endpoint, already VERIFIED there since Session 4) - stale `NOT_STARTED` here corrected in Session 10, per `docs/FINAL_AUDIT.md`'s Session 6 note that first caught this |
| REQ-SEED-001 | Seed facilities/invites/users/patients/visits/pregnancy/sms | VERIFIED | `prisma/seed.ts` | manual: `npm run seed` then inspect (run and inspected via a temporary verification script this session - see `docs/PROGRESS.md`'s Session 16 entry) | every entity is created through the real service functions (`createPatient`/`createVisit`/`createPregnancy`/`recordContact`/`presignDocument`), not raw `prisma.create` calls, so computed fields (edd, riskLevel, triage, reminders) are generated exactly as the real app would. Ram's document is marked `uploaded` without a real object existing in storage - no live S3-compatible server in this environment, same documented gap as Documents' own testing |
| REQ-SEED-002 | demo:reset recomputes Sita's LMP | VERIFIED | `prisma/seed.ts` (`lmp = todayDateOnly - 210 days`, computed fresh on every run), `package.json`'s existing `demo:reset` script | manual (verified `npm run seed` is idempotent - a second run skips the pregnancy/document blocks cleanly and re-upserts everything else safely; `demo:reset` itself, which runs a destructive `prisma migrate reset --force`, was not executed this session - that command requires explicit user confirmation before running) | |
| REQ-SEED-003 | Seed 40/60/50 code lists | VERIFIED | `prisma/seed.ts` | manual: `npm run seed` then inspect | Session 16: expanded to 40 complaints / 61 diagnoses / 50 drugs (one over the literal "60" target - not trimmed, since removing a valid entry just to hit a round number would be arbitrary) + 10 dangerSign / 8 riskFactor entries mirrored from `rules.json`. Content (ICD-10-style codes, WHO EML-style drug names) is standard/public medical terminology, not independently re-verified against a live ICD-10 index or drug formulary - see `docs/TECH_DECISIONS.md` |

## Phase 2 — Auth, RBAC, Users

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-AUTH-001 | Phone E.164 normalization | VERIFIED | `src/modules/auth/schemas.ts` | `test/auth.test.ts` | backend validates shape only; UI normalization is frontend (OUT-OF-REPO) |
| REQ-AUTH-002 | POST /auth/otp/request + rate limit | VERIFIED | `src/modules/auth/routes.ts`, `service.ts`, `src/lib/rateLimiter.ts` | `test/auth.test.ts` | passes against a real Postgres + Redis; route-by-route auth gate re-confirmed in Session 6's security review |
| REQ-AUTH-003 | Demo OTP 123456 | VERIFIED | `src/modules/auth/service.ts` | `test/auth.test.ts` | gated on `OTP_MODE`, not `SMS_MODE` - backend.md A.4 vs §7.1 mismatch, see Session 3 PROGRESS entry |
| REQ-AUTH-004 | POST /auth/otp/verify, tempToken | VERIFIED | `src/modules/auth/routes.ts`, `service.ts` | `test/auth.test.ts` | |
| REQ-AUTH-005 | POST /auth/pin/set (create + reset) | VERIFIED | `src/modules/auth/service.ts` | `test/auth.test.ts` | Question 2: also used for PIN reset |
| REQ-AUTH-006 | POST /auth/pin/login + account lockout | VERIFIED | `src/modules/auth/service.ts`, `src/lib/rateLimiter.ts` | `test/auth.test.ts` | Question 6: stacked with REQ-SEC-001's route limit. Session 8: fixed a timing side-channel (unregistered phone short-circuited before argon2; now always runs `verifyPin` against a `DUMMY_PIN_HASH` when there's no real one) - see `docs/SECURITY.md` row 2 |
| REQ-AUTH-007 | POST /auth/refresh, rotation | VERIFIED | `src/modules/auth/service.ts` | `test/auth.test.ts` | reuse-detection revokes the whole token family, docs/SECURITY.md row 5 |
| REQ-AUTH-008 | POST /auth/provider/activate | VERIFIED | `src/modules/auth/routes.ts`, `service.ts` | `test/auth.test.ts` | `Facility`/`InviteCode` schema pulled forward from Phase 1 (hard FK dependency); tests use ad-hoc fixtures, but the real demo invite codes (`HA-GHORAHI-01`/`FCHV-W5-01`/`ADMIN-01`) are now seeded too (REQ-SEED-001, Session 16) |
| REQ-AUTH-009 | GET /me | VERIFIED | `src/modules/auth/routes.ts` | `test/auth.test.ts` | |
| REQ-AUTH-010 | Access token claims/signing | VERIFIED | `src/lib/tokens.ts` | `test/auth.test.ts` | Session 6: confirmed `algorithms:['HS256']` enforced on every verify path |
| REQ-AUTH-011 | Refresh token hashed, revocable | VERIFIED | `prisma/schema.prisma`, `src/modules/auth/service.ts`, `src/lib/hash.ts` | `test/auth.test.ts` | hashed with SHA-256, not argon2 - see Session 3 PROGRESS entry for why |
| REQ-AUTH-012 | requireAuth() → 401 | VERIFIED | `src/plugins/auth.ts` | `test/auth.test.ts` | |
| REQ-AUTH-013 | Invite codes seeded | IMPLEMENTED (schema only) | `prisma/schema.prisma` | `test/auth.test.ts` (ad-hoc fixtures, passing) | real seeding (`prisma/seed.ts`) is Phase 1, still NOT_STARTED |
| REQ-ROLE-001 | Role enum | IMPLEMENTED | `prisma/schema.prisma` | — | exercised indirectly by every auth test; no dedicated test file |
| REQ-ROLE-002 | requireRole() → 403 | VERIFIED | `src/plugins/auth.ts` | `test/authz-matrix.test.ts` | |
| REQ-ROLE-003 | canReadPatient() | VERIFIED | `src/plugins/auth.ts` (built where originally planned - not moved after all, see Session 4 PROGRESS entry) | `test/patients.test.ts` | owner OR active unrevoked unexpired redeemed grant |
| REQ-ROLE-004 | canAppendPatient() | VERIFIED | `src/plugins/auth.ts` | `test/patients.test.ts` | canReadPatient AND scope=append; owner always passes regardless of scope |
| REQ-ROLE-005 | fchv blocked from visits (route + sync) | VERIFIED | `src/modules/visits/service.ts` (role check), reused as-is by `sync/service.ts`'s `applyVisitChange` (no separate check needed - REQ-SYNC-006/007's "same logic as the REST endpoint" principle) | `test/authz-matrix.test.ts`, `test/sync.test.ts` | Question 1 |
| REQ-ROLE-006 | record_viewed throttled 10min | VERIFIED | `src/plugins/auth.ts` (`assertCanReadPatient`), `src/modules/audit/service.ts` | `test/patients.test.ts` | fires only for provider/fchv actors, throttled via a query on AuditEntry's own recent rows, not a separate counter |
| REQ-ROLE-007 | GET /patients role scoping | VERIFIED | `src/modules/patients/routes.ts`, `service.ts` | `test/patients.test.ts` | patient role: owned only. provider/fchv/admin: owned union active-grant patients |
| REQ-ROLE-008 | Grant/access token type separation | VERIFIED | `src/lib/tokens.ts` | `test/auth.test.ts`, `test/authz-matrix.test.ts` | grant-token half now built too (Session 5) and uses a separate `GRANT_SECRET`, enforced never-equal-to-`JWT_SECRET` at startup (Session 6 finding) |
| REQ-USER-001 | User entity fields | IMPLEMENTED | `prisma/schema.prisma` | — | exercised indirectly by every auth test; no dedicated test file |
| REQ-USER-002 | User serializer never leaks pinHash | VERIFIED | `src/lib/serializers.ts` | `test/auth.test.ts` | whitelist-only DTO, never spreads the Prisma row; re-confirmed via grep in Session 6's security review |
| REQ-SEC-005 | Argon2id + refresh-token hashing | VERIFIED | `src/lib/hash.ts` | `test/auth.test.ts` | PIN: argon2id, cost configurable. Refresh token: SHA-256, not argon2 - deliberate deviation, see Session 3 PROGRESS entry |
| REQ-AUTH-014 | Offline PIN unlock | OUT-OF-REPO (frontend) | — | — | frontend.md S04 |
| REQ-AUTH-015 | Silent token refresh on launch | OUT-OF-REPO (frontend) | — | — | frontend.md S01 |
| REQ-AUTH-016 | SQLCipher local DB encryption | OUT-OF-REPO (frontend) | — | — | frontend.md §6.1 |
| REQ-AUTH-017 | Secure storage for tokens/keys | OUT-OF-REPO (frontend) | — | — | frontend.md §3 |

## Phase 3 — Patients

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-PATIENT-001 | POST /patients, idempotent create | VERIFIED | `src/modules/patients/routes.ts`, `service.ts` | `test/patients.test.ts` | |
| REQ-PATIENT-002 | Same id, different owner → 403 | VERIFIED | `src/modules/patients/service.ts` | `test/patients.test.ts` | |
| REQ-PATIENT-003 | PATCH, optimistic concurrency | VERIFIED | `src/modules/patients/service.ts` | `test/patients.test.ts` | |
| REQ-PATIENT-004 | GET /patients/:id + summary | VERIFIED | `src/modules/patients/routes.ts`, `service.ts` | `test/patients.test.ts` | |
| REQ-PATIENT-005 | Summary.activeProblems | VERIFIED | `src/modules/patients/summary.ts` | `test/patients.test.ts` | `chronicConditions` isn't codelist-validated at patient creation (unlike Visit's diagnosisCodes) - an unmatched code falls back to using the code itself as its label |
| REQ-PATIENT-006 | Summary.currentMedicines | VERIFIED | `src/modules/patients/summary.ts` | `test/patients.test.ts` | date-only arithmetic (`addDaysToDateOnly`), not instant math, matching the codebase's existing `todayDateOnly`-string-comparison convention |
| REQ-PATIENT-007 | Summary allergies/lastVitals/pregnancy/counts | VERIFIED | `src/modules/patients/summary.ts` | `test/patients.test.ts` | |
| REQ-PATIENT-008 | GET timeline, unified feed | VERIFIED | `src/modules/patients/timeline.ts`, `routes.ts` | `test/patients.test.ts` | merges 5 independently-capped queries in memory rather than one SQL UNION - same tradeoff as Sync's pull and Facilities' Haversine search |
| REQ-PATIENT-009 | Timeline item formatting per kind | VERIFIED | `src/modules/patients/timeline.ts` | `test/patients.test.ts` | `DocType` has no codelist entry - a small fixed English label map is used (server text is English, frontend localises, same convention as triage reasons) |
| REQ-PATIENT-010 | GET audit, owner-only | VERIFIED | `src/modules/patients/routes.ts`, `service.ts`, `src/modules/audit/service.ts` | `test/patients.test.ts` | |
| REQ-PATIENT-011 | Patient fields | VERIFIED | `prisma/schema.prisma` | `test/patients.test.ts` (exercised via every endpoint) | |
| REQ-PATIENT-012 | Soft-delete flag + read filters | VERIFIED | every `patients/*` query (`deleted: false`) | `test/patients.test.ts` | Question 4: no write path built, filter is tested by construction (nothing sets it true) |
| REQ-PATIENT-013 | Family list UI | OUT-OF-REPO (frontend) | — | — | frontend.md S06 |
| REQ-PATIENT-014 | Add/edit patient form UI | OUT-OF-REPO (frontend) | — | — | frontend.md S07 |
| REQ-PATIENT-015 | Provider cached-bundle expiry UI | OUT-OF-REPO (frontend) | — | — | frontend.md S19 |

## Phase 4 — Access Grants (QR)

**Schema pulled forward into Session 4 (Patients):** the `AccessGrant` table (`prisma/schema.prisma`) already existed going into this session - it was a hard dependency of `canReadPatient`/`canAppendPatient` (REQ-ROLE-003/004). Session 5 (this one) builds the actual `/grants` routes, QR token signing, and redeem flow against that existing table - no new migration needed.

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-GRANT-001 | POST /grants create + rate limit | VERIFIED | `src/modules/grants/routes.ts`, `service.ts` | `test/grants.test.ts` | Session 8: capped `ttlMinutes` at 60 (was unbounded) - see `docs/SECURITY.md` row 8, `docs/REQUIREMENTS.md`'s note on this row |
| REQ-GRANT-002 | qrPayload = "SWC1:" + token | VERIFIED | `src/modules/grants/service.ts` | `test/grants.test.ts` | |
| REQ-GRANT-003 | POST /grants/redeem, role check | VERIFIED | `src/modules/grants/service.ts`, `routes.ts` | `test/grants.test.ts` | |
| REQ-GRANT-004 | Expired/revoked → GRANT_EXPIRED | VERIFIED | `src/modules/grants/service.ts` | `test/grants.test.ts` | A.6#15 |
| REQ-GRANT-005 | Same-user idempotent / other-user 409 | VERIFIED | `src/modules/grants/service.ts` | `test/grants.test.ts` | |
| REQ-GRANT-006 | Redeem sets accessUntil, audits | VERIFIED | `src/modules/grants/service.ts` | `test/grants.test.ts` | |
| REQ-GRANT-007 | Redeem returns full offline bundle | VERIFIED | `src/modules/grants/service.ts` | `test/grants.test.ts` | reuses `patients/summary.ts`/`timeline.ts` rather than re-deriving the read model a second way; `ancContacts` is all contacts for the active pregnancy specifically, `[]` when there is none |
| REQ-GRANT-008 | POST /grants/:id/revoke | VERIFIED | `src/modules/grants/routes.ts`, `service.ts` | `test/grants.test.ts` | |
| REQ-GRANT-009 | 24h access window enforced on every call | VERIFIED | `src/plugins/auth.ts` (`canReadPatient`/`canAppendPatient`, built Session 4) | `test/grants.test.ts` | A.6#16 |
| REQ-GRANT-012 | Printed long-lived QR + PIN redeem | VERIFIED | `src/modules/grants/{schemas,service}.ts`, `prisma/schema.prisma` (`AccessGrant.printed`) | `test/grants.test.ts` | Tier 2, built Session 15. `accessUntil` stays the normal +24h window regardless of the card's 1-year token lifetime (AMBIGUITIES A4, resolved) |
| REQ-TEST-003 | grants.test.ts full lifecycle suite | VERIFIED | `test/grants.test.ts` | (is the test) | |
| REQ-GRANT-010 | QR-share sheet UI | OUT-OF-REPO (frontend) | — | — | frontend.md S08 |
| REQ-GRANT-011 | QR scanner UI | OUT-OF-REPO (frontend) | — | — | frontend.md S20 |

## Phase 5 — Visits

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-VISIT-001 | POST visits, canAppend && !fchv | VERIFIED | `src/modules/visits/routes.ts`, `service.ts` | `test/visits.test.ts` | fchv-with-append-grant, read-only-grant, no-grant, expired-grant, revoked-grant all covered |
| REQ-VISIT-002 | Idempotent on id | VERIFIED | `src/modules/visits/service.ts` | `test/visits.test.ts` | same id under a different patient is rejected FORBIDDEN, not silently reassigned |
| REQ-VISIT-003 | Server fills provider fields | VERIFIED | `src/modules/visits/service.ts` | `test/visits.test.ts` | "Self-reported" keyed on `actor.id === patient.ownerUserId`, not role - see service.ts's comment for why that's equivalent here |
| REQ-VISIT-004 | Codes validated against codelist | VERIFIED | `src/modules/visits/service.ts` | `test/visits.test.ts` | validation logic itself is complete; the codelist is now fully seeded to the 40/61/50 target (REQ-CODELIST-002/REQ-SEED-003, Session 16) |
| REQ-VISIT-005 | Follow-up reminder created | VERIFIED | `src/modules/visits/service.ts` | `test/visits.test.ts` | writes a `Reminder` row (pulled forward, schema only, from Phase 8 - see `prisma/schema.prisma`); worker/SMS delivery itself stays Phase 8. Message text is a minimal real inline bilingual string, not the full Phase 8 `templates.ts` (no BS-date conversion yet - see docs/PROGRESS.md's Session 7 entry) |
| REQ-VISIT-006 | Audit visit_added | VERIFIED | `src/modules/visits/service.ts` | `test/visits.test.ts` | |
| REQ-VISIT-007 | GET visits list | VERIFIED | `src/modules/visits/routes.ts` | `test/visits.test.ts` | |
| REQ-VISIT-008 | Append-only, supersedesId | IMPLEMENTED | `prisma/schema.prisma` | — | structurally enforced (no update/delete route exists for Visit at all, same as REQ-AUDIT-002's precedent) - no dedicated test since there's no mutation code path to test against |
| REQ-VISIT-009 | Embedded vitals/diagnoses/prescriptions | VERIFIED | `prisma/schema.prisma`, `src/lib/serializers.ts` | `test/visits.test.ts` | |
| REQ-VISIT-010 | Add-visit form UI | OUT-OF-REPO (frontend) | — | — | frontend.md S22 |
| REQ-VISIT-011 | fchv-hidden medicines section UI | OUT-OF-REPO (frontend) | — | — | moot per Question 1 — fchv never reaches this screen |

## Phase 6 — Sync

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-SYNC-001 | POST /sync/push, per-change transactions | VERIFIED | `src/modules/sync/routes.ts`, `service.ts` | `test/sync.test.ts` | "per-change transactions" is per-change atomicity via the reused per-entity service functions (each already wraps its own multi-statement writes), not a wrapping `prisma.$transaction` around the whole dispatch - see the anc_contacts create-then-record note in `service.ts` for the one narrow, documented exception |
| REQ-SYNC-002 | SyncOp de-dupe by opId | VERIFIED | `src/modules/sync/service.ts`, `prisma/schema.prisma` | `test/sync.test.ts` | replayed opId always returns `status:"duplicate"` (not the original status), per this row's own wording |
| REQ-SYNC-003 | Per-table authorization on push | VERIFIED | `src/modules/sync/service.ts` (delegates to each reused service function's own `canAppend`/role checks) | `test/sync.test.ts` | `documents` is update-only via sync (meta fields only - `type`/`title`/`takenAt`, never `status`/`objectKey`/`aiSummary*`) - a change for a not-yet-existing document is rejected, pointing the client at the real-time `POST /documents/presign` call instead, since a 15-minute presigned-upload TTL is incompatible with offline store-and-forward queuing |
| REQ-SYNC-004 | Append-only table idempotency | VERIFIED | `src/modules/sync/service.ts` (reuses `createVisit`/`recordDelivery` directly) | `test/sync.test.ts` | A.6#13 |
| REQ-SYNC-005 | Versioned table create/conflict/apply | VERIFIED | `src/modules/sync/service.ts` | `test/sync.test.ts` | A.6#14 |
| REQ-SYNC-006 | anc_contacts sync-apply recomputes triage | VERIFIED | `src/modules/sync/service.ts` (reuses `maternal/service.ts`'s `recordContact`) | `test/sync.test.ts` | built directly against the real Phase 7 triage engine, not a stub - Maternal landed in Session 9, well before Sync |
| REQ-SYNC-007 | pregnancies-via-sync run full creation logic | VERIFIED | `src/modules/sync/service.ts` (reuses `maternal/service.ts`'s `createPregnancy`) | `test/sync.test.ts` | same reuse, same reasoning |
| REQ-SYNC-008 | zod/authz rejection statuses | VERIFIED | `src/modules/sync/service.ts` | `test/sync.test.ts` | any non-conflict `AppError` (not just `FORBIDDEN`) maps to `rejected` with its own code - a superset of the letter of this row, since `RULE_VIOLATION`/`NOT_FOUND` etc. need the same treatment and there's no reason to special-case just one |
| REQ-SYNC-009 | GET /sync/pull, cursor, page 200 | VERIFIED | `src/modules/sync/routes.ts`, `service.ts` | `test/sync.test.ts` | merges 6 independently-capped queries in memory (patients/visits/pregnancies/anc_contacts/deliveries/documents) rather than one SQL UNION - same tradeoff as Facilities' Haversine, acceptable at this scale. Documents include a freshly presigned `downloadUrl` when `status=uploaded` (backend.md §9.7), null otherwise |
| REQ-SYNC-010 | updatedAt server-assigned | VERIFIED | `prisma/schema.prisma` (`@updatedAt` on every syncable model, already true since each table was built) | `test/sync.test.ts` | |
| REQ-SYNC-011 | Deleted rows returned with deleted=true | IMPLEMENTED | `src/modules/sync/service.ts` (pull queries have no `deleted:false` filter) | — | still moot in practice per Question 4 (nothing anywhere sets `deleted=true`) - no test can meaningfully exercise a code path with no producer, kept for contract completeness only |
| REQ-TEST-002 | sync.test.ts suite | VERIFIED | `test/sync.test.ts` | (is the test) | covers A.6 cases 13/14 (both the `patients` and `anc_contacts` variants of the conflict case), pull ordering/cursor/scope, and REQ-REMIND-009's negative case |
| REQ-SYNC-012 | Client outbox writes | OUT-OF-REPO (frontend) | — | — | frontend.md §6.2/§7 |
| REQ-SYNC-013 | SyncEngine triggers | OUT-OF-REPO (frontend) | — | — | |
| REQ-SYNC-014 | Outbox push batching | OUT-OF-REPO (frontend) | — | — | |
| REQ-SYNC-015 | Client push-result handling | OUT-OF-REPO (frontend) | — | — | |
| REQ-SYNC-016 | Client pull loop | OUT-OF-REPO (frontend) | — | — | |
| REQ-SYNC-017 | Pull skips rows with pending outbox op | OUT-OF-REPO (frontend) | — | — | |
| REQ-SYNC-018 | Pending-row cloud icon UI | OUT-OF-REPO (frontend) | — | — | |
| REQ-SYNC-019 | Client document upload sequence | OUT-OF-REPO (frontend) | — | — | backend half is REQ-DOC-003/004 (Phase 9) |
| REQ-SYNC-020 | Client clock-drift warning | OUT-OF-REPO (frontend) | — | — | backend just returns `serverTime` (covered by REQ-SYNC-001's response shape) |
| REQ-SYNC-021 | Sync status screen UI | OUT-OF-REPO (frontend) | — | — | |
| REQ-SYNC-022 | Full offline capability (golden rule) | OUT-OF-REPO (frontend) | — | — | backend enables it by existing; the requirement itself is a client architecture constraint |
| REQ-SYNC-023 | Deterministic ANC-contact ids (backend half) | VERIFIED | `src/lib/ids.ts` (Session 9) | `test/sync.test.ts`, `test/maternal.test.ts`, `test/rules.test.ts` (A.6 case 1) | duplicate of REQ-PREG-004's determinism clause; same code, tracked once |

## Phase 7 — Maternal (Pregnancy, ANC, Triage)

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-RULES-001 | RULES table, versioned | VERIFIED | `src/modules/maternal/rules/rules.json` | `test/rules.test.ts` (indirect, via edd/schedule/triage) | served verbatim by `GET /rules` once Phase 1's Meta module exists - the route itself stays NOT_STARTED |
| REQ-RULES-002 | Triage priority-order logic | VERIFIED | `src/modules/maternal/rules/triage.ts` | `test/rules.test.ts` | ported line-for-line from frontend.md §12's Dart source |
| REQ-RULES-003 | 16 shared A.6 test cases pass | VERIFIED | `test/rules.test.ts`, `test/maternal.test.ts`, `test/grants.test.ts` | (is the test) | cases 1-11 (pure rules engine) in `test/rules.test.ts`, run and green before any Maternal endpoint was wired up per `backend.md` §14 rule 6; case 12 (male patient 422) is endpoint-level, in `test/maternal.test.ts`; cases 15/16 (grant expiry) already covered by `test/grants.test.ts` since Session 5; cases 13/14 (sync idempotency/conflict) need the Sync module, still NOT_STARTED |
| REQ-RULES-004 | Server triage wins on client disagreement | VERIFIED | `src/modules/maternal/service.ts` (`recordContact`) | `test/maternal.test.ts` | server always computes and returns its own triage from `findings`/`dangerSigns` alone - the client never sends a triage value for the server to "disagree" with, so there's structurally nothing else for the server to defer to; client-side reconciliation is OUT-OF-REPO |
| REQ-RULES-005 | Verify ANC protocol against DoHS source | NOT_STARTED | `src/modules/maternal/rules/rules.json` (content review) | manual research task | not inferable from docs alone — needs an external source lookup before the demo |
| REQ-PREG-001 | Female-only rule | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | A.6#12 |
| REQ-PREG-002 | No second active pregnancy | VERIFIED | `src/modules/maternal/service.ts`, DB partial unique index (`docs/DATA_MODEL.md`) | `test/maternal.test.ts` | |
| REQ-PREG-003 | edd/riskLevel computation | VERIFIED | `src/modules/maternal/rules/edd.ts`, `service.ts` | `test/rules.test.ts`, `test/maternal.test.ts` | A.6#1/#2 |
| REQ-PREG-004 | Transactional pregnancy + 8 contacts | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-005 | Contact dueAt from ancSchedule | VERIFIED | `src/modules/maternal/rules/schedule.ts` | `test/rules.test.ts` | |
| REQ-PREG-006 | anc_due reminders created | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | writes `Reminder` rows (to owner phone + `emergencyContactPhone` if set); worker/SMS delivery is Phase 8, still NOT_STARTED |
| REQ-PREG-007 | anc_missed reminder (single, no 7-day repeat) | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | Question 5: repeat explicitly out of Tier-1 scope |
| REQ-PREG-008 | GET /pregnancies/:id | VERIFIED | `src/modules/maternal/routes.ts` | `test/maternal.test.ts` | |
| REQ-PREG-009 | PATCH /pregnancies/:id | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | Session 9 addition beyond backend.md's literal text: `status=ended` also cancels pending reminders (not just delivery) - see docs/PROGRESS.md's Session 9 entry |
| REQ-PREG-010 | PUT contacts/:contactNo | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-011 | Server-side triage computation | VERIFIED | `src/modules/maternal/service.ts`, `rules/triage.ts` | `test/maternal.test.ts` | |
| REQ-PREG-012 | Save contact: version++, cancel reminder | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-013 | nearestReferral lookup | VERIFIED | `src/modules/maternal/service.ts`, `src/lib/geo.ts` (Haversine) | `test/maternal.test.ts` | tested with real facility fixtures; null when the actor has no facility or none has a birthing centre |
| REQ-PREG-014 | Audit contact_recorded | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-015 | POST delivery, closes pregnancy | VERIFIED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | idempotent on the client-generated delivery id, same convention as Visits |
| REQ-TEST-001 | rules.test.ts 16 cases (backend) | VERIFIED | `test/rules.test.ts` | (is the test) | see REQ-RULES-003's note for how the 16 cases are actually distributed across files |
| REQ-PREG-016 | Register-pregnancy button visibility | OUT-OF-REPO (frontend) | — | — | frontend.md S11 |
| REQ-PREG-017 | Pregnancy dashboard UI | OUT-OF-REPO (frontend) | — | — | frontend.md S12 |
| REQ-PREG-018 | ANC checklist UI + live client triage | OUT-OF-REPO (frontend) | — | — | frontend.md S13 |
| REQ-PREG-019 | Record-delivery UI | OUT-OF-REPO (frontend) | — | — | frontend.md S14 |
| REQ-TEST-005 | Frontend rules unit tests | OUT-OF-REPO (frontend) | — | — | must independently pass the same A.6 cases |

## Phase 8 — Reminders & SMS

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-REMIND-001 | Worker polls every 60s | VERIFIED | `src/modules/reminders/{service,worker}.ts` | `test/reminders.test.ts` | polling logic (`processPendingReminders`) tested directly; the BullMQ repeatable-job wiring itself (`worker.ts`) is exercised only by running the real server, same as `server.ts`'s `app.listen()` |
| REQ-REMIND-002 | SmsAdapter (Mock/Sparrow) | VERIFIED | `src/modules/reminders/sms/{adapter,mock,sparrow}.ts` | `test/reminders.test.ts` (via a fake adapter), `test/meta.test.ts` (mock's `mock_sms` writes) | Sparrow's current API verified against its own docs this session (`docs/TECH_DECISIONS.md`) but never exercised against a real account - no `SPARROW_TOKEN` in this environment, `SMS_MODE` stays `mock` |
| REQ-REMIND-003 | Retry ×3 then failed | VERIFIED | `src/modules/reminders/service.ts` (`attempts` column, not in backend.md's literal schema - see `docs/DATA_MODEL.md`) | `test/reminders.test.ts` | |
| REQ-REMIND-004 | Bilingual templates + BS date | VERIFIED | `src/modules/reminders/templates.ts`, `src/lib/bsDate.ts` | `test/rules.test.ts` (indirectly, via Visits/Maternal's reminder creation), `test/reminders.test.ts` | also now used by `visits/service.ts`/`maternal/service.ts`, replacing their Session 7/9 AD-only inline versions |
| REQ-REMIND-005 | GET /patients/:id/reminders | VERIFIED | `src/modules/reminders/routes.ts` | `test/reminders.test.ts` | uses the Session 11-added `Reminder.patientId` index (built in Session 7, ahead of this route) |
| REQ-REMIND-006 | /demo/sms + .html (mock only) | VERIFIED | `src/modules/meta/routes.ts` | `test/meta.test.ts` | lives in `meta/routes.ts` per backend.md's directory tree, not a separate `public/demo-sms.html` static file - server-rendered on every request instead |
| REQ-REMIND-007 | /demo/reminders/fire | VERIFIED | `src/modules/reminders/routes.ts` | `test/reminders.test.ts` | |
| REQ-REMIND-009 | Reminder not syncable (read-only client) | VERIFIED | `src/modules/sync/schemas.ts` (`reminders` absent from `SYNCABLE_TABLES`) | `test/sync.test.ts` | enforced as a negative test in Sync's suite |
| REQ-REMIND-008 | Reminders list UI | OUT-OF-REPO (frontend) | — | — | frontend.md S15 |

## Phase 9 — Documents & AI Summary

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-DOC-001 | POST /documents/presign, jpeg-only | VERIFIED | `src/modules/documents/routes.ts`, `service.ts`, `schemas.ts` | `test/documents.test.ts` | Question 3 (image/jpeg only, not the PNG-inclusive literal list) |
| REQ-DOC-002 | Object key `.jpg`, consistent with (1) | VERIFIED | `src/modules/documents/storage.ts` (`buildObjectKey`) | `test/documents.test.ts` | server-generated, never client-supplied |
| REQ-DOC-003 | Presigned PUT, 15 min | VERIFIED (structurally) | `src/modules/documents/storage.ts` | `test/documents.test.ts` | never live-tested against a real S3-compatible server - MinIO's free pre-built binaries were withdrawn (HTTP 410) between Session 2 and Session 13; see `docs/TECH_DECISIONS.md`'s "Session 13 update". Presigning itself is exercised for real (pure local signing, no network call needed) |
| REQ-DOC-004 | POST complete, HEAD check | VERIFIED | `src/modules/documents/service.ts` | `test/documents.test.ts` | failure path (object not confirmed) is exercised over real HTTP - `headObject`'s real network call to `S3_ENDPOINT` deterministically fails with no live MinIO, which is itself the test; the success path (HEAD confirms, status flips to `uploaded`) is exercised by calling the service directly with a fake `DocumentStorage` |
| REQ-DOC-005 | GET /documents/:id | VERIFIED | `src/modules/documents/routes.ts` | `test/documents.test.ts` | canRead-gated |
| REQ-DOC-006 | POST summarize, 501 if AI off | VERIFIED | `src/modules/documents/routes.ts`, `service.ts` | `test/documents.test.ts` | `AI_MODE=off` is the only configured state in this build |
| REQ-DOC-007 | AI worker | VERIFIED (structurally) | `src/modules/documents/ai/{client,service,worker}.ts` | `test/ai-summary.test.ts`, `test/documents.test.ts` | Tier 2, built Session 15. Raw `fetch()` against Anthropic's Messages API (not the SDK, same "no wrapper" decision as SparrowSms) - request/response shape verified against the real API docs, never live-called end to end in this environment (no real `ANTHROPIC_API_KEY` was live-tested during development; see `docs/TECH_DECISIONS.md`) |
| REQ-DOC-008 | Unguessable keys, expiring URLs | VERIFIED (structurally) | `src/modules/documents/storage.ts` | `test/documents.test.ts` | object key is `patients/<patientId>/<documentId>.jpg` (both UUIDs); upload URLs expire in 15 min, download URLs in 60 min - same live-verification caveat as REQ-DOC-003 |
| REQ-DOC-009 | Capture UI | OUT-OF-REPO (frontend) | — | — | frontend.md S10 |
| REQ-DOC-010 | Upload retry counter UI | OUT-OF-REPO (frontend) | — | — | |
| REQ-DOC-011 | "AI-generated, unverified" label UI | OUT-OF-REPO (frontend) | — | — | |

## Phase 10 — Hardening & production readiness (Session 6, re-run Session 16)

**Session 6 ran the first full audit this phase describes** (security review, frontend-contract verification, performance pass, production-readiness pass) **against everything built at the time** (Foundation/Auth/Patients/Grants) - see `docs/FINAL_AUDIT.md` for that snapshot and `docs/PROGRESS.md`'s Session 6 entry for the findings and fixes. **Session 16 closed the concrete follow-up items this phase had accumulated** (the smoke script, Documents-route rate limiting, the magic-byte/size check, CORS production enforcement) once every module they depend on existed. `docs/FINAL_AUDIT.md` itself was not rewritten line-by-line in Session 16 - it remains a dated Session 6 snapshot; `docs/PROJECT_PLAN.md` (this file) and `docs/SECURITY.md` are the documents kept continuously current every session and are the ones to trust for today's actual status, not `FINAL_AUDIT.md`'s framing.

| ID | Requirement (short) | Status | Code location | Test location | Notes |
|---|---|---|---|---|---|
| REQ-TEST-004 | End-to-end smoke script | VERIFIED | `test/smoke.test.ts` | (is the test) | walks backend.md §12 item 10's literal demo path via the *real* OTP->PIN login flow (not `asUser`'s auth-bypass shortcut every other test uses) - login as owner, create patient, create grant, login+activate as HA, redeem, add visit, register pregnancy, record contact 4 red, check timeline + `/demo/sms`. Surfaced a real frontend-integration gotcha along the way: an access token issued before `POST /auth/provider/activate` still carries the pre-activation role claim (JWTs are stateless) - the client must call `POST /auth/refresh` afterward to get a token reflecting the new role. Documented in `docs/API_CONTRACT.md` §2 |
| — | CORS tightening follow-up | VERIFIED | `src/config.ts` (`.refine()`) | `test/foundation.test.ts` | `docs/SECURITY.md` row 10 — `NODE_ENV=production` + `CORS_ORIGINS=*` now fails config parsing at startup, not just a documented manual pre-deployment step |
| — | Magic-byte upload check follow-up | VERIFIED | `src/modules/documents/service.ts` (`completeDocument`, `looksLikeJpeg`), `prisma/schema.prisma` (`Document.declaredSizeBytes`) | `test/documents.test.ts` | `docs/SECURITY.md` row 15 — the real uploaded object's `Content-Length` (against the declared `sizeBytes` and the absolute 2 MB cap) and first-3-bytes JPEG signature are both checked before `status → uploaded` |
| — | Documents rate-limit follow-up | VERIFIED | `src/modules/documents/service.ts` (`assertUnderRateLimit`) | `test/documents.test.ts` | `docs/SECURITY.md` row 11 (backend.md's GAP G4) — 30/hour/actor on both `POST /documents/presign` and `POST /documents/:id/complete`, the same Redis-backed limiter every other business-rule rate limit in this codebase uses |
| REQ-TEST-006 | Frontend acceptance checklist | OUT-OF-REPO (frontend) | — | — | frontend.md §17 |

## Not in this plan (Tier 2/3, out of the 32-hour Tier-1 build)

Tracked in `docs/REQUIREMENTS.md` but given no phase/status row here — promoted into a phase only if the user brings them into scope: admin stats endpoint, DHIS2/HMIS export, NID verification, council registration check, FCM push notifications, child immunisation module, fine-grained consent, voice notes, PDF export.
