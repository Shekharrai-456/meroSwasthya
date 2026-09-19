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
| REQ-FACILITY-001 | GET /facilities/nearby, Haversine | NOT_STARTED | `src/modules/facilities/routes.ts` | `test/facilities.test.ts` | |
| REQ-FACILITY-002 | Facility fields | IMPLEMENTED (schema only) | `prisma/schema.prisma` | `test/facilities.test.ts` | pulled forward into Session 3 - `User.facilityId`/`InviteCode.facilityId` are hard FK dependencies on this table; no `/facilities/nearby` route or Haversine logic added |
| REQ-CODELIST-001 | GET /codelists, versioned, cached | NOT_STARTED | `src/modules/codelists/routes.ts` | `test/codelists.test.ts` | |
| REQ-CODELIST-002 | CodeListItem fields | IMPLEMENTED (schema only) | `prisma/schema.prisma` | `test/visits.test.ts` (indirectly, via fixtures) | pulled forward into Session 7 - REQ-VISIT-004 (codes validated against codelist) is a hard dependency, same rationale as every earlier pull-forward in this file |
| REQ-META-001 | GET /rules serves RULES verbatim | NOT_STARTED | `src/modules/meta/routes.ts` | `test/meta.test.ts` | depends on `rules.json` existing (Phase 6) |
| REQ-META-002 | GET /config feature flags | NOT_STARTED | `src/modules/meta/routes.ts` | `test/meta.test.ts` | |
| REQ-AUDIT-001 | AuditEntry written on 7 actions | IMPLEMENTED (partial) | `src/modules/audit/service.ts` (`logAudit`), called from `src/plugins/auth.ts`, `src/modules/grants/service.ts`, `src/modules/visits/service.ts` | `test/patients.test.ts`, `test/grants.test.ts`, `test/visits.test.ts` | 5 of 7 actions are now wired up (`record_viewed` since Session 4; `grant_created`/`grant_redeemed`/`grant_revoked` since Session 5; `visit_added` since Session 7). The remaining 2 (`contact_recorded`, `document_added`) get their call sites when Maternal/Documents (Phase 7/9) are built |
| REQ-AUDIT-002 | Audit rows immutable | IMPLEMENTED | `prisma/schema.prisma` (no `deleted` field, no update/delete code path on AuditEntry anywhere) | — | structurally enforced (nothing in the codebase can modify a row); no dedicated test since there's no code path to test against |
| REQ-AUDIT-003 | GET /patients/:id/audit, owner-only | NOT_STARTED | `src/modules/patients/routes.ts` | `test/patients.test.ts` | endpoint lives in Patients module; row here since it's fundamentally an audit-read concern |
| REQ-SEED-001 | Seed facilities/invites/users/patients/visits/pregnancy/sms | NOT_STARTED | `prisma/seed.ts` | manual: `npm run seed` then inspect | |
| REQ-SEED-002 | demo:reset recomputes Sita's LMP | NOT_STARTED | `prisma/seed.ts`, `package.json` script | manual | |
| REQ-SEED-003 | Seed 40/60/50 code lists | IMPLEMENTED (partial) | `prisma/seed.ts` | manual: `npm run seed` then inspect | Session 7: seeded 17 complaints/18 diagnoses/19 drugs, all real (not placeholder) codes, sufficient to exercise REQ-VISIT-004 and demo Visits end to end - short of the full 40/60/50 curated target, which is a content-authoring task independent of any module's logic |

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
| REQ-AUTH-008 | POST /auth/provider/activate | VERIFIED | `src/modules/auth/routes.ts`, `service.ts` | `test/auth.test.ts` | `Facility`/`InviteCode` schema pulled forward from Phase 1 (hard FK dependency); seed script itself (REQ-SEED-001) still NOT_STARTED, tests use ad-hoc fixtures |
| REQ-AUTH-009 | GET /me | VERIFIED | `src/modules/auth/routes.ts` | `test/auth.test.ts` | |
| REQ-AUTH-010 | Access token claims/signing | VERIFIED | `src/lib/tokens.ts` | `test/auth.test.ts` | Session 6: confirmed `algorithms:['HS256']` enforced on every verify path |
| REQ-AUTH-011 | Refresh token hashed, revocable | VERIFIED | `prisma/schema.prisma`, `src/modules/auth/service.ts`, `src/lib/hash.ts` | `test/auth.test.ts` | hashed with SHA-256, not argon2 - see Session 3 PROGRESS entry for why |
| REQ-AUTH-012 | requireAuth() → 401 | VERIFIED | `src/plugins/auth.ts` | `test/auth.test.ts` | |
| REQ-AUTH-013 | Invite codes seeded | IMPLEMENTED (schema only) | `prisma/schema.prisma` | `test/auth.test.ts` (ad-hoc fixtures, passing) | real seeding (`prisma/seed.ts`) is Phase 1, still NOT_STARTED |
| REQ-ROLE-001 | Role enum | IMPLEMENTED | `prisma/schema.prisma` | — | exercised indirectly by every auth test; no dedicated test file |
| REQ-ROLE-002 | requireRole() → 403 | VERIFIED | `src/plugins/auth.ts` | `test/authz-matrix.test.ts` | |
| REQ-ROLE-003 | canReadPatient() | VERIFIED | `src/plugins/auth.ts` (built where originally planned - not moved after all, see Session 4 PROGRESS entry) | `test/patients.test.ts` | owner OR active unrevoked unexpired redeemed grant |
| REQ-ROLE-004 | canAppendPatient() | VERIFIED | `src/plugins/auth.ts` | `test/patients.test.ts` | canReadPatient AND scope=append; owner always passes regardless of scope |
| REQ-ROLE-005 | fchv blocked from visits (route + sync) | NOT_STARTED | `src/plugins/auth.ts`, enforced in `visits/routes.ts` and `sync/service.ts` | `test/authz-matrix.test.ts` | Question 1; depends on Phase 5 (visits)/6 (sync) existing |
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
| REQ-PATIENT-004 | GET /patients/:id + summary | IMPLEMENTED (partial) | `src/modules/patients/routes.ts`, `service.ts` | `test/patients.test.ts` | patient entity only, no `summary` block - see REQ-PATIENT-005/006/007 |
| REQ-PATIENT-005 | Summary.activeProblems | NOT_STARTED | — | — | needs the Visit table (Phase 5) + CodeListItem (Phase 1); deliberately not stubbed, see Session 4 PROGRESS entry |
| REQ-PATIENT-006 | Summary.currentMedicines | NOT_STARTED | — | — | needs the Visit table (Phase 5); same reasoning as REQ-PATIENT-005 |
| REQ-PATIENT-007 | Summary allergies/lastVitals/pregnancy/counts | NOT_STARTED | — | — | needs Visit (Phase 5) + Pregnancy (Phase 7); `allergies` alone is trivially `= patient.allergies` but the REQ ships as one unit with the rest |
| REQ-PATIENT-008 | GET timeline, unified feed | NOT_STARTED | — | — | unions Visit/Document/Pregnancy/AncContact/Delivery - none exist until Phase 5/7/9 |
| REQ-PATIENT-009 | Timeline item formatting per kind | NOT_STARTED | — | — | depends on REQ-PATIENT-008 |
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
| REQ-GRANT-007 | Redeem returns full offline bundle | IMPLEMENTED (partial) | `src/modules/grants/service.ts` | `test/grants.test.ts` | ships `{grant, patient}` only - `summary`/`timeline`/`pregnancy`/`ancContacts` need Visit/Pregnancy/AncContact (Phase 5/7), same reasoning as REQ-PATIENT-004..009 |
| REQ-GRANT-008 | POST /grants/:id/revoke | VERIFIED | `src/modules/grants/routes.ts`, `service.ts` | `test/grants.test.ts` | |
| REQ-GRANT-009 | 24h access window enforced on every call | VERIFIED | `src/plugins/auth.ts` (`canReadPatient`/`canAppendPatient`, built Session 4) | `test/grants.test.ts` | A.6#16 |
| REQ-GRANT-012 | Printed long-lived QR + PIN redeem | NOT_STARTED | `src/modules/grants/service.ts` | `test/grants.test.ts` | Tier 2 — build only if time allows |
| REQ-TEST-003 | grants.test.ts full lifecycle suite | VERIFIED | `test/grants.test.ts` | (is the test) | |
| REQ-GRANT-010 | QR-share sheet UI | OUT-OF-REPO (frontend) | — | — | frontend.md S08 |
| REQ-GRANT-011 | QR scanner UI | OUT-OF-REPO (frontend) | — | — | frontend.md S20 |

## Phase 5 — Visits

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-VISIT-001 | POST visits, canAppend && !fchv | VERIFIED | `src/modules/visits/routes.ts`, `service.ts` | `test/visits.test.ts` | fchv-with-append-grant, read-only-grant, no-grant, expired-grant, revoked-grant all covered |
| REQ-VISIT-002 | Idempotent on id | VERIFIED | `src/modules/visits/service.ts` | `test/visits.test.ts` | same id under a different patient is rejected FORBIDDEN, not silently reassigned |
| REQ-VISIT-003 | Server fills provider fields | VERIFIED | `src/modules/visits/service.ts` | `test/visits.test.ts` | "Self-reported" keyed on `actor.id === patient.ownerUserId`, not role - see service.ts's comment for why that's equivalent here |
| REQ-VISIT-004 | Codes validated against codelist | VERIFIED | `src/modules/visits/service.ts` | `test/visits.test.ts` | validation logic itself is complete; the codelist it validates against is only partially seeded - see REQ-CODELIST-002/REQ-SEED-003 |
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
| REQ-SYNC-001 | POST /sync/push, per-change transactions | NOT_STARTED | `src/modules/sync/routes.ts`, `service.ts` | `test/sync.test.ts` | |
| REQ-SYNC-002 | SyncOp de-dupe by opId | NOT_STARTED | `src/modules/sync/service.ts`, `prisma/schema.prisma` | `test/sync.test.ts` | |
| REQ-SYNC-003 | Per-table authorization on push | NOT_STARTED | `src/modules/sync/service.ts` | `test/sync.test.ts`, `test/authz-matrix.test.ts` | |
| REQ-SYNC-004 | Append-only table idempotency | NOT_STARTED | `src/modules/sync/service.ts` | `test/sync.test.ts` | A.6#13 |
| REQ-SYNC-005 | Versioned table create/conflict/apply | NOT_STARTED | `src/modules/sync/service.ts` | `test/sync.test.ts` | A.6#14 |
| REQ-SYNC-006 | anc_contacts sync-apply recomputes triage | NOT_STARTED | `src/modules/sync/service.ts` | `test/sync.test.ts` | depends on Phase 7's `rules/triage.ts` — built here as a stub, wired for real once Phase 7 lands |
| REQ-SYNC-007 | pregnancies-via-sync run full creation logic | NOT_STARTED | `src/modules/sync/service.ts` | `test/sync.test.ts` | same cross-phase dependency as above |
| REQ-SYNC-008 | zod/authz rejection statuses | NOT_STARTED | `src/modules/sync/service.ts` | `test/sync.test.ts` | |
| REQ-SYNC-009 | GET /sync/pull, cursor, page 200 | NOT_STARTED | `src/modules/sync/routes.ts`, `service.ts` | `test/sync.test.ts` | |
| REQ-SYNC-010 | updatedAt server-assigned | NOT_STARTED | `prisma/schema.prisma` (`@updatedAt`) | `test/sync.test.ts` | |
| REQ-SYNC-011 | Deleted rows returned with deleted=true | NOT_STARTED | `src/modules/sync/service.ts` | `test/sync.test.ts` | moot in practice per Question 4 (nothing sets `deleted=true`), kept for contract completeness |
| REQ-TEST-002 | sync.test.ts suite | NOT_STARTED | `test/sync.test.ts` | (is the test) | |
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
| REQ-SYNC-023 | Deterministic ANC-contact ids (backend half) | NOT_STARTED | `src/lib/ids.ts` | `test/sync.test.ts`, `test/maternal.test.ts` | duplicate of REQ-PREG-004's determinism clause; same code, tracked once |

## Phase 7 — Maternal (Pregnancy, ANC, Triage)

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-RULES-001 | RULES table, versioned | NOT_STARTED | `src/modules/maternal/rules/rules.json` | `test/rules.test.ts` | served by Phase 1's `GET /rules` once this exists |
| REQ-RULES-002 | Triage priority-order logic | NOT_STARTED | `src/modules/maternal/rules/triage.ts` | `test/rules.test.ts` | |
| REQ-RULES-003 | 16 shared A.6 test cases pass | NOT_STARTED | `test/rules.test.ts` | (is the test) | **must pass before wiring endpoints**, per `backend.md` §14 rule 6 — build this file first in this phase |
| REQ-RULES-004 | Server triage wins on client disagreement | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | backend just always returns its own computed value; client-side reconciliation is OUT-OF-REPO |
| REQ-RULES-005 | Verify ANC protocol against DoHS source | NOT_STARTED | `src/modules/maternal/rules/rules.json` (content review) | manual research task | not inferable from docs alone — needs an external source lookup before the demo |
| REQ-PREG-001 | Female-only rule | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | A.6#12 |
| REQ-PREG-002 | No second active pregnancy | NOT_STARTED | `src/modules/maternal/service.ts`, DB partial unique index (`docs/DATA_MODEL.md`) | `test/maternal.test.ts` | |
| REQ-PREG-003 | edd/riskLevel computation | NOT_STARTED | `src/modules/maternal/rules/edd.ts`, `service.ts` | `test/rules.test.ts`, `test/maternal.test.ts` | A.6#1/#2 |
| REQ-PREG-004 | Transactional pregnancy + 8 contacts | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-005 | Contact dueAt from ancSchedule | NOT_STARTED | `src/modules/maternal/rules/schedule.ts` | `test/rules.test.ts` | |
| REQ-PREG-006 | anc_due reminders created | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | writes `Reminder` rows; worker is Phase 8 |
| REQ-PREG-007 | anc_missed reminder (single, no 7-day repeat) | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | Question 5: repeat explicitly out of Tier-1 scope |
| REQ-PREG-008 | GET /pregnancies/:id | NOT_STARTED | `src/modules/maternal/routes.ts` | `test/maternal.test.ts` | |
| REQ-PREG-009 | PATCH /pregnancies/:id | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-010 | PUT contacts/:contactNo | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-011 | Server-side triage computation | NOT_STARTED | `src/modules/maternal/service.ts`, `rules/triage.ts` | `test/maternal.test.ts` | |
| REQ-PREG-012 | Save contact: version++, cancel reminder | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-013 | nearestReferral lookup | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | depends on Phase 1 facilities |
| REQ-PREG-014 | Audit contact_recorded | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-PREG-015 | POST delivery, closes pregnancy | NOT_STARTED | `src/modules/maternal/service.ts` | `test/maternal.test.ts` | |
| REQ-TEST-001 | rules.test.ts 16 cases (backend) | NOT_STARTED | `test/rules.test.ts` | (is the test) | |
| REQ-PREG-016 | Register-pregnancy button visibility | OUT-OF-REPO (frontend) | — | — | frontend.md S11 |
| REQ-PREG-017 | Pregnancy dashboard UI | OUT-OF-REPO (frontend) | — | — | frontend.md S12 |
| REQ-PREG-018 | ANC checklist UI + live client triage | OUT-OF-REPO (frontend) | — | — | frontend.md S13 |
| REQ-PREG-019 | Record-delivery UI | OUT-OF-REPO (frontend) | — | — | frontend.md S14 |
| REQ-TEST-005 | Frontend rules unit tests | OUT-OF-REPO (frontend) | — | — | must independently pass the same A.6 cases |

## Phase 8 — Reminders & SMS

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-REMIND-001 | Worker polls every 60s | NOT_STARTED | `src/modules/reminders/worker.ts` | `test/reminders.test.ts` | |
| REQ-REMIND-002 | SmsAdapter (Mock/Sparrow) | NOT_STARTED | `src/modules/reminders/sms/{adapter,mock,sparrow}.ts` | `test/reminders.test.ts` | Sparrow: verify current API before relying on it |
| REQ-REMIND-003 | Retry ×3 then failed | NOT_STARTED | `src/modules/reminders/worker.ts` | `test/reminders.test.ts` | |
| REQ-REMIND-004 | Bilingual templates + BS date | NOT_STARTED | `src/modules/reminders/templates.ts` | `test/reminders.test.ts` | |
| REQ-REMIND-005 | GET /patients/:id/reminders | NOT_STARTED | `src/modules/reminders/routes.ts` | `test/reminders.test.ts` | uses the Phase 5.5-added `Reminder.patientId` index |
| REQ-REMIND-006 | /demo/sms + .html (mock only) | NOT_STARTED | `src/modules/meta/routes.ts`, `public/demo-sms.html` | `test/reminders.test.ts` | |
| REQ-REMIND-007 | /demo/reminders/fire | NOT_STARTED | `src/modules/meta/routes.ts` | `test/reminders.test.ts` | |
| REQ-REMIND-009 | Reminder not syncable (read-only client) | NOT_STARTED | `src/modules/sync/service.ts` (reminders excluded from allowed tables) | `test/sync.test.ts` | enforced as a negative test in Sync's suite |
| REQ-REMIND-008 | Reminders list UI | OUT-OF-REPO (frontend) | — | — | frontend.md S15 |

## Phase 9 — Documents & AI Summary

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-DOC-001 | POST /documents/presign, jpeg-only | NOT_STARTED | `src/modules/documents/routes.ts`, `service.ts`, `schemas.ts` | `test/documents.test.ts` | Question 3 |
| REQ-DOC-002 | Object key `.jpg`, consistent with (1) | NOT_STARTED | `src/modules/documents/service.ts` | `test/documents.test.ts` | |
| REQ-DOC-003 | Presigned PUT, 15 min | NOT_STARTED | `src/modules/documents/storage.ts` | `test/documents.test.ts` | tunnel-vs-proxy decision (backend.md §5 gotcha) made in Session 2 infra setup |
| REQ-DOC-004 | POST complete, HEAD check | NOT_STARTED | `src/modules/documents/service.ts` | `test/documents.test.ts` | |
| REQ-DOC-005 | GET /documents/:id | NOT_STARTED | `src/modules/documents/routes.ts` | `test/documents.test.ts` | |
| REQ-DOC-006 | POST summarize, 501 if AI off | NOT_STARTED | `src/modules/documents/routes.ts`, `service.ts` | `test/documents.test.ts` | |
| REQ-DOC-007 | AI worker | NOT_STARTED | `src/modules/documents/ai.worker.ts` | `test/documents.test.ts` | Tier 2 |
| REQ-DOC-008 | Unguessable keys, expiring URLs | NOT_STARTED | `src/modules/documents/storage.ts` | `test/documents.test.ts` | |
| REQ-DOC-009 | Capture UI | OUT-OF-REPO (frontend) | — | — | frontend.md S10 |
| REQ-DOC-010 | Upload retry counter UI | OUT-OF-REPO (frontend) | — | — | |
| REQ-DOC-011 | "AI-generated, unverified" label UI | OUT-OF-REPO (frontend) | — | — | |

## Phase 10 — Hardening & production readiness (Session 6)

**Session 6 ran the full audit this phase describes** (security review, frontend-contract verification, performance pass, production-readiness pass) **against everything built so far** (Foundation/Auth/Patients/Grants) - see `docs/FINAL_AUDIT.md` for the complete requirement-by-requirement result and `docs/PROGRESS.md`'s Session 6 entry for the findings and fixes. The individual rows below stay `NOT_STARTED` because their specific deliverables (a dedicated smoke-test script, the Documents module's magic-byte check, the frontend's own acceptance run) don't exist yet or depend on modules that aren't built - not because the audit itself didn't happen. This phase will need re-running once Visits/Sync/Maternal/Reminders/Documents/Facilities land, since most of `docs/SECURITY.md`'s rows are only "not applicable yet" today, not verified against real code.

| ID | Requirement (short) | Status | Code location (planned) | Test location (planned) | Notes |
|---|---|---|---|---|---|
| REQ-TEST-004 | End-to-end smoke script | NOT_STARTED | `scripts/smoke.sh` or `test/smoke.test.ts` | (is the test) | exercises every phase above together; `test/patients.test.ts`/`test/grants.test.ts`'s own integration tests cover the equivalent ground for what's built so far, but there's no dedicated cross-module script |
| — | CORS tightening follow-up | NOT_STARTED | `src/config.ts` | manual | `docs/SECURITY.md` row 13 — only relevant past the hackathon demo; now documented as an explicit pre-deployment step in `README.md`'s Deployment notes |
| — | Magic-byte upload check follow-up | NOT_STARTED | `src/modules/documents/service.ts` | `test/documents.test.ts` | `docs/SECURITY.md` row 16 — documented gap, not yet built (Documents module itself doesn't exist) |
| REQ-TEST-006 | Frontend acceptance checklist | OUT-OF-REPO (frontend) | — | — | frontend.md §17 |

## Not in this plan (Tier 2/3, out of the 32-hour Tier-1 build)

Tracked in `docs/REQUIREMENTS.md` but given no phase/status row here — promoted into a phase only if the user brings them into scope: admin stats endpoint, DHIS2/HMIS export, NID verification, council registration check, FCM push notifications, child immunisation module, fine-grained consent, voice notes, PDF export.
