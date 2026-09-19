# Requirements Ledger — Swasthya Card

Source documents read in full this session:

| File | One-line summary |
|---|---|
| `CLAUDE.md` | Operating rules for the whole build (session protocol, traceability, evidence rules, decide-vs-ask, coding/testing/API/DB standards, docs to maintain). Ships with a placeholder `[stack]` assumption of Python/FastAPI, explicitly flagged for rewrite once the real stack is known. |
| `SESSION_PROMPTS.md` | The seven-session build plan (this file's own Session 0 prompt lives here) plus resume/correction prompts. No product content. |
| `documentation/backend.md` | Full backend spec for "Swasthya Card": Node/TS/Fastify/Prisma/PostgreSQL/Redis/MinIO stack, Prisma schema, auth flow, module-by-module endpoint behaviour (patients, grants, visits, documents, maternal, reminders, sync, facilities/codelists/meta), seed data, error/security rules, testing list, 32-hour plan, and **Part A** — the API contract shared verbatim with the frontend doc. |
| `documentation/frontend.md` | Full Flutter frontend spec: offline-first architecture (Drift local DB, outbox, SyncEngine), screens S01–S23 with entities/APIs/UI/logic per screen, the Dart rules engine (edd/schedule/triage — must mirror the backend TS implementation), mock-API mode, i18n/BS-date conventions, and the same **Part A** contract as the backend doc. |

Every requirement below cites a source as `file §section`. Rows with no citation are marked **ASSUMPTION**.
ID format: `REQ-<AREA>-<NNN>`, assigned once, never renumbered.

Type legend: F = functional, SEC = security, D = data/schema, NFR = non-functional, UX = UI/UX, T = testing.

---

## AUTH (login, OTP, PIN, tokens)

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-AUTH-001 | Phone number is the identity; app normalises to E.164 (+977…) before sending | backend.md §7.1 / frontend.md A.1, S02 | F | - | Low | |
| REQ-AUTH-002 | `POST /auth/otp/request` starts login/registration; rate-limited 5 per phone per 10 min → 429 `RATE_LIMITED` | backend.md §7.1 step1, A.4 | F | REQ-AUTH-001 | Med | |
| REQ-AUTH-003 | When `OTP_MODE=demo`, OTP is always `123456`, returned as `demoOtp` in the response, no SMS sent | backend.md §5, §7.1, A.4 | F | REQ-AUTH-002 | Low | Demo-only. **New contradiction found in Session 3:** backend.md §7.1 step 1 gates the fixed code + `demoOtp` field on `OTP_MODE=demo`, but A.4's endpoint doc gates `demoOtp`'s presence on `SMS_MODE=mock` instead - two different env vars. Resolved on `OTP_MODE=demo`, matching this row, `REQ-META-002`'s `config.otpDemo` flag (which frontend.md S02 already keys its UI off), and the more conservative reading (never echo a real, `OTP_MODE=real` OTP in the response even if SMS happens to be mocked). See `docs/PROGRESS.md`'s Session 3 entry. |
| REQ-AUTH-004 | `POST /auth/otp/verify` checks code and attempt count (max 5), issues a 10-minute `tempToken` (JWT, `typ:"temp"`), and reports `hasPin`/`isNewUser` | backend.md §7.1 step2, A.4 | F | REQ-AUTH-002 | Med | |
| REQ-AUTH-005 | `POST /auth/pin/set` (Bearer tempToken) creates the user if missing (role `patient`), hashes PIN with argon2id, issues access (12 h) + refresh (30 d) tokens | backend.md §7.1 step3, A.4 | F | REQ-AUTH-004 | High | See OPEN_QUESTIONS Q2 — reuse for PIN reset is unclear |
| REQ-AUTH-006 | `POST /auth/pin/login` verifies PIN with argon2; 5 wrong PINs locks the account for 15 min (Redis key) | backend.md §7.1 step4 | F | REQ-AUTH-005 | High | Overlaps REQ-SEC-001; see AMBIGUITIES A2 |
| REQ-AUTH-007 | `POST /auth/refresh` rotates the refresh/access token pair from an opaque refresh token | backend.md §7.1 step5, A.4 | F | REQ-AUTH-005 | High | |
| REQ-AUTH-008 | `POST /auth/provider/activate` upgrades a logged-in user to `provider`/`fchv` via a seeded invite code, setting role + facility | backend.md §7.1 step6, A.4 | F | REQ-AUTH-005, REQ-SEED-001 | Med | |
| REQ-AUTH-009 | `GET /me` returns the current authenticated user | backend.md A.4 | F | REQ-AUTH-005 | Low | |
| REQ-AUTH-010 | Access token JWT claims `{sub, role, fid, typ:"access", iat, exp}`, HS256 signed with `JWT_SECRET`, 12 h TTL | backend.md §7.2, §5 | SEC | - | High | |
| REQ-AUTH-011 | Refresh tokens are opaque (32 bytes), stored **hashed**, 30-day TTL, revocable | backend.md §5, §6 `RefreshToken` model | SEC | REQ-AUTH-007 | High | |
| REQ-AUTH-012 | `requireAuth()` returns 401 `UNAUTHENTICATED` for missing/invalid/expired access tokens | backend.md §7.3, A.3 | SEC | REQ-AUTH-010 | High | |
| REQ-AUTH-013 | Invite codes are seeded data, mapped to a role + facility, and may be reusable in the demo build | backend.md §6 `InviteCode`, §10 | D | REQ-SEED-001 | Low | |
| REQ-AUTH-014 | Local PIN unlock: when a valid session exists, PIN is checked **offline** against a locally stored hash to open the encrypted local DB; only refreshes tokens if online | frontend.md S04 | F | REQ-AUTH-016 | Med | |
| REQ-AUTH-015 | App silently refreshes the access token on launch if less than 1 h remains | frontend.md S01 | F | REQ-AUTH-007 | Low | |
| REQ-AUTH-016 | Local database opened via SQLCipher with a 32-byte key derived from the PIN using PBKDF2-HMAC-SHA256 (100,000 iterations, per-device salt in secure storage); wrong PIN cannot open the DB | frontend.md §6.1 | SEC | - | High | Doc explicitly permits shipping unencrypted (keeping the derivation code) if it costs >1 h — a documented scope-reduction fallback, not an assumption |
| REQ-AUTH-017 | Tokens, PIN hash, and the DB key material live in `flutter_secure_storage`, never in shared preferences | frontend.md §3, S05 | SEC | REQ-AUTH-016 | High | |

## ROLE / AUTHORIZATION

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-ROLE-001 | Four roles: `patient`, `provider`, `fchv`, `admin` (admin has no app UI — web dashboard is Tier 2/roadmap) | backend.md §6 enum `Role`; frontend.md §2.1 | D | - | Low | |
| REQ-ROLE-002 | `requireRole(...)` dependency returns 403 `FORBIDDEN` when role isn't allowed | backend.md §7.3 | SEC | REQ-AUTH-012 | High | |
| REQ-ROLE-003 | `canReadPatient(user, patientId)`: true if owner OR an unrevoked grant redeemed by this user with `accessUntil > now` | backend.md §7.3 | SEC | REQ-GRANT-008 | High | Central authorization primitive — see AS2 |
| REQ-ROLE-004 | `canAppendPatient(user, patientId)`: `canReadPatient` AND grant `scope = "append"` (owner always passes) | backend.md §7.3 | SEC | REQ-ROLE-003 | High | |
| REQ-ROLE-005 | `fchv` role is blocked (403) from creating Visits, even with an append grant; may still append pregnancies, ANC contacts, and documents | backend.md §7.3, §9.3, §9.7 | SEC | REQ-ROLE-004 | High | Stated identically in 3 places in backend.md (§7.3, §9.3, §9.7) — internally consistent on the backend side. See CONTRADICTIONS C1 vs frontend S22. |
| REQ-ROLE-006 | Every `canRead` access by a provider/fchv writes a `record_viewed` audit entry, throttled to at most once per 10 minutes per (actor, patient) | backend.md §7.3 | SEC | REQ-AUDIT-001 | Med | |
| REQ-ROLE-007 | `GET /patients` scopes results by role: `patient` → owned; `provider`/`fchv` → owned ∪ patients with an active redeemed grant | backend.md §9.1 | F | REQ-ROLE-003 | Med | Confirms provider/fchv can also own family profiles (frontend.md S06 note) |
| REQ-ROLE-008 | Grant tokens (`typ:"grant"`) cannot be used as bearer access tokens, and access tokens cannot redeem grants — the two token types are never interchangeable | backend.md §11 | SEC | REQ-AUTH-010, REQ-GRANT-002 | High | |

## USER

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-USER-001 | `User` entity: id, phone (unique), pinHash, role, name, facilityId, createdAt | backend.md §6 | D | - | Low | |
| REQ-USER-002 | User serializer (`toUserDto`) never includes `pinHash`; no response body or log line may contain a password/PIN hash or token | backend.md §8, §11 | SEC | REQ-USER-001 | High | |

## PATIENTS (family profiles)

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-PATIENT-001 | `POST /patients` creates a family profile with a **client-generated** UUID; posting the same id twice is idempotent (200, existing row) | backend.md §9.1, A.1, A.4 | F | REQ-AUTH-005 | Med | |
| REQ-PATIENT-002 | Same id created under a different owner → 403 `FORBIDDEN` (not a generic conflict) | backend.md §9.1 | SEC | REQ-PATIENT-001 | Med | |
| REQ-PATIENT-003 | `PATCH /patients/:id` is owner-only and optimistic-concurrency controlled: `body.version` must equal current version, else 409 `VERSION_CONFLICT` with `details.current` | backend.md §9.1, A.3, A.4 | F | REQ-PATIENT-001 | Med | |
| REQ-PATIENT-004 | `GET /patients/:id` returns the patient plus a computed **summary** block used by the provider screen | backend.md §9.1 | F | REQ-ROLE-003 | Med | |
| REQ-PATIENT-005 | Summary.`activeProblems`: distinct diagnosis codes across non-deleted visits + `chronicConditions`, joined to codelist labels, with `since` = earliest visit date for that code | backend.md §9.1.1 | F | REQ-VISIT-002, REQ-CODELIST-001 | Med | |
| REQ-PATIENT-006 | Summary.`currentMedicines`: prescriptions where `visitAt + durationDays >= today`, newest first, de-duplicated by `drugCode` keeping the latest | backend.md §9.1.1 | F | REQ-VISIT-002 | Med | |
| REQ-PATIENT-007 | Summary also includes `allergies`, `lastVitals` (from the latest visit that has any vitals), `activePregnancy`, `lastVisitAt`, `visitCount` | backend.md §9.1.1 | F | REQ-VISIT-002, REQ-PREG-008 | Low | |
| REQ-PATIENT-008 | `GET /patients/:id/timeline` unions visits, documents, pregnancy-registered, done ANC contacts, and deliveries into one feed, cursor-paginated (`before`, limit 50, `nextBefore`) | backend.md §9.1.2, A.4 | F | REQ-ROLE-003 | Med | |
| REQ-PATIENT-009 | Each timeline item is formatted per its kind with a pre-built `title`/`subtitle`/`badge` (exact formatting strings specified per kind) | backend.md §9.1.2 | F | REQ-PATIENT-008 | Low | |
| REQ-PATIENT-010 | `GET /patients/:id/audit` is owner-only | backend.md §9.1, A.4 | SEC | REQ-ROLE-003, REQ-AUDIT-001 | Med | |
| REQ-PATIENT-011 | Patient fields: name, sex, dob (AD date only), bloodGroup, ward, municipality, allergies[], chronicConditions[], emergencyContactPhone, version, updatedAt, deleted | backend.md §6, A.2 | D | - | Low | |
| REQ-PATIENT-012 | `deleted` is a soft-delete flag; every query path must filter it, and that filter must be tested | CLAUDE.md §9; backend.md §11 "Soft deletes only" | NFR | REQ-PATIENT-011 | Med | No documented endpoint ever sets it — see GAPS G5 |
| REQ-PATIENT-013 | Family list (S06) reads the local DB first for instant display, then triggers a background sync; shows a "Pregnant · week N" badge when `activePregnancy` is set | frontend.md S06 | UX | REQ-PATIENT-007, REQ-SYNC-013 | Low | |
| REQ-PATIENT-014 | Add/edit patient form validates: name ≥ 2 chars, DOB ≤ today, emergency phone E.164 if provided; writes locally + outbox and returns immediately (no network wait) | frontend.md S07 | UX | REQ-SYNC-012 | Low | |
| REQ-PATIENT-015 | Provider's cached patient bundles (from a redeemed grant) are hidden from the "recent patients" list once `accessUntil` passes | frontend.md S19 | F | REQ-GRANT-009 | Low | |

## ACCESS GRANTS (QR sharing)

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-GRANT-001 | `POST /grants` is owner-only, rate-limited 20/hour/patient, creates an `AccessGrant` + signs a JWT (`typ:"grant", gid, pid, scope, exp`) with `GRANT_SECRET` | backend.md §9.2, §5, A.4 | SEC | REQ-PATIENT-001 | High | **Session 8 addition:** `ttlMinutes` is capped at 60 (`src/modules/grants/schemas.ts`) - not in backend.md's literal text, which leaves it unbounded. Added because an unbounded ttl on this Tier-1 endpoint would let a caller mint the equivalent of REQ-GRANT-012's long-lived QR without that feature's required PIN-at-redeem safeguard. See `docs/PROGRESS.md`'s Session 8 entry. |
| REQ-GRANT-002 | QR payload string = `"SWC1:" + token`; scanner must reject any other prefix | backend.md §9.2, A.7; frontend.md S20, §14 | F | REQ-GRANT-001 | Med | Version bump path = `SWC2` if the format ever changes |
| REQ-GRANT-003 | `POST /grants/redeem`: role must be `provider` or `fchv` (else 403 `FORBIDDEN`); parses the `SWC1:` prefix and verifies the JWT with `GRANT_SECRET` | backend.md §9.2, A.4 | SEC | REQ-GRANT-002, REQ-ROLE-002 | High | |
| REQ-GRANT-004 | Expired grant (`exp < now` or `expiresAt < now`) → 403 `GRANT_EXPIRED`; revoked grant → 403 `GRANT_EXPIRED` | backend.md §9.2, A.3, A.6#15 | F | REQ-GRANT-003 | High | |
| REQ-GRANT-005 | Redeem by the same user who already redeemed it → idempotent, returns the bundle again; redeem by a **different** user → 409 `ALREADY_REDEEMED` | backend.md §9.2 | F | REQ-GRANT-003 | Med | |
| REQ-GRANT-006 | Successful redeem sets `redeemedByUserId`, `redeemedAt`, `accessUntil = now + 24h`, and logs `grant_redeemed` | backend.md §9.2 | F | REQ-GRANT-003, REQ-AUDIT-001 | Med | |
| REQ-GRANT-007 | Redeem response returns the full offline bundle: grant, patient, summary, latest-50 timeline, active pregnancy, all ANC contacts | backend.md §9.2, A.4 | F | REQ-GRANT-006, REQ-PATIENT-004, REQ-PATIENT-008 | Med | |
| REQ-GRANT-008 | `POST /grants/:id/revoke` is owner-only, sets `revokedAt`, logs `grant_revoked`; provider access ends immediately | backend.md §9.2, A.4 | F | REQ-GRANT-001, REQ-AUDIT-001 | Med | |
| REQ-GRANT-009 | The 24-hour access window is enforced on every subsequent read/append, not just at redeem time | backend.md A.6#16 | SEC | REQ-ROLE-003 | High | e.g. adding a visit 25 h after redeem → 403 `GRANT_EXPIRED` |
| REQ-GRANT-010 | Frontend QR-share sheet (S08): shows a live 10-minute countdown from `grant.expiresAt` (using server time offset), with Regenerate and Revoke actions; requires network | frontend.md S08 | UX | REQ-GRANT-001, REQ-SYNC-020 | Low | |
| REQ-GRANT-011 | Frontend scanner (S20) accepts only payloads starting with `SWC1:`; other QR codes are ignored with a toast; on success the bundle is written to the local DB with `access_until` set | frontend.md S20 | F | REQ-GRANT-007 | Low | |
| REQ-GRANT-012 | Printed long-lived QR (`ttlMinutes = 525600`, `scope:"read"`) requires the patient's PIN in the redeem request body — **Tier 2** | backend.md A.7 | F | REQ-GRANT-003 | Low | Build only if time allows per the doc; see AMBIGUITIES A7 |

## VISITS

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-VISIT-001 | `POST /patients/:id/visits` requires `canAppendPatient` **and** role ≠ `fchv` | backend.md §9.3 | SEC | REQ-ROLE-004, REQ-ROLE-005 | High | |
| REQ-VISIT-002 | Creation is idempotent on the client-generated `id` | backend.md §9.3, A.1 | F | REQ-VISIT-001 | Med | |
| REQ-VISIT-003 | Server fills `providerUserId`/`providerName`/facility from the auth token; when the patient owner self-adds a visit, `providerName = "Self-reported"` | backend.md §9.3 | F | REQ-VISIT-001 | Low | |
| REQ-VISIT-004 | Complaint, diagnosis, and drug codes must exist in the codelist, else 400 `VALIDATION_ERROR` with field details | backend.md §9.3 | F | REQ-CODELIST-001 | Med | |
| REQ-VISIT-005 | If `followUpAt` is set, create a `follow_up` Reminder due at `followUpAt − 1 day` 09:00 Asia/Kathmandu, to the patient's phone | backend.md §9.3, A.5 reminders.follow_up | F | REQ-VISIT-001, REQ-REMIND-001 | Med | |
| REQ-VISIT-006 | Visit creation logs `visit_added` | backend.md §9.3 | F | REQ-AUDIT-001 | Low | |
| REQ-VISIT-007 | `GET /patients/:id/visits` lists newest-first, limit 50 | backend.md §9.3, A.4 | F | REQ-ROLE-003 | Low | |
| REQ-VISIT-008 | Visits are append-only after sync; a correction is a **new** Visit with `supersedesId` pointing at the original | backend.md A.2 | D | REQ-VISIT-002 | Med | |
| REQ-VISIT-009 | Visit carries embedded `vitals` object, `diagnosisCodes[]`, and embedded `prescriptions[]` (no separate prescription table) | backend.md A.2; frontend.md §6 | D | - | Low | |
| REQ-VISIT-010 | Add-visit screen (S22): searchable complaint picklist, numeric vitals row, multi-select diagnoses, medicine rows (drug picklist, dose, frequency segmented control, days, Nepali instruction chips), advice, follow-up date, referral toggle | frontend.md S22 | UX | REQ-CODELIST-001, REQ-VISIT-004 | Low | |
| REQ-VISIT-011 | fchv role sees the visit screen with the medicines/prescription section hidden | frontend.md S22 | UX | REQ-VISIT-001 | Med | Conflicts with REQ-VISIT-001/ROLE-005 which block fchv from the endpoint entirely — see CONTRADICTIONS C1 |

## DOCUMENTS (paper capture)

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-DOC-001 | `POST /documents/presign`: `canAppendPatient`, size ≤ 2 MB, `contentType` in `[image/jpeg, image/png]` | backend.md §9.4 | F | REQ-ROLE-004 | Med | |
| REQ-DOC-002 | Object key = `patients/{patientId}/{documentId}.jpg`; row created with `status=pending_upload` | backend.md §9.4 | D | REQ-DOC-001 | Med | Extension is hard-coded `.jpg` regardless of accepted PNG content type — see CONTRADICTIONS C2 |
| REQ-DOC-003 | `uploadUrl` is a presigned PUT valid 15 minutes, generated against the **public** storage endpoint | backend.md §9.4, §5 | F | REQ-DOC-001 | Med | Phones must be able to reach the storage host — tunnel or proxy fallback must be decided early (backend.md §5 "gotcha") |
| REQ-DOC-004 | `POST /documents/:id/complete` verifies the object exists (HEAD), sets `status=uploaded`, logs `document_added`, returns a 1-hour presigned download URL | backend.md §9.4 | F | REQ-DOC-003, REQ-AUDIT-001 | Med | |
| REQ-DOC-005 | `GET /documents/:id` returns metadata plus a freshly-presigned download URL | backend.md §9.4 | F | REQ-ROLE-003 | Low | |
| REQ-DOC-006 | `POST /documents/:id/summarize` returns 501 `NOT_IMPLEMENTED` when `AI_MODE=off`; otherwise sets `aiSummaryStatus=queued` and enqueues the AI job | backend.md §9.4, §5 | F | REQ-DOC-004 | Low | App hides the button when `config.aiSummaryEnabled` is false |
| REQ-DOC-007 | AI worker downloads the object, calls a vision LLM, and stores a Nepali+English summary with a medicines list and an "AI draft — verify" footer; status becomes `done`/`failed` | backend.md §3, §9.4 | F | REQ-DOC-006 | Low | Tier 2 |
| REQ-DOC-008 | Object keys are unguessable UUIDs; download URLs always expire (1 h) | backend.md §11 | SEC | REQ-DOC-002 | Med | |
| REQ-DOC-009 | Capture UI (S10): camera → type picker → title → BS date → preview → save; image compressed to ≤300 KB / 1600 px before upload | frontend.md S10 | UX | - | Low | |
| REQ-DOC-010 | Failed uploads retry up to 5 times, tracked via `upload_attempts` on the local row | frontend.md §7, S10 | NFR | REQ-DOC-003 | Low | |
| REQ-DOC-011 | AI summary is always displayed with a visible "AI-generated, unverified" label | frontend.md S10 | UX | REQ-DOC-007 | Low | |

## MATERNAL — Pregnancy, ANC contacts, delivery, triage

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-PREG-001 | `POST /patients/:id/pregnancies`: patient `sex` must be `female`, else 422 `RULE_VIOLATION` | backend.md §9.5, A.6#12 | F | REQ-ROLE-004 | Med | |
| REQ-PREG-002 | No second **active** pregnancy allowed for the same patient, else 422 | backend.md §9.5 | F | REQ-PREG-001 | Med | |
| REQ-PREG-003 | `edd = body.edd ?? lmp + 280 days`; `riskLevel = "high"` if any `riskFactors` present, else `"normal"` | backend.md §9.5, A.2, A.6#1-2 | F | REQ-PREG-001 | Med | |
| REQ-PREG-004 | Creation is transactional: pregnancy + 8 `AncContact` rows with **deterministic ids** (`uuid v5(pregnancyId + ":" + contactNo)`) | backend.md §9.5, A.8#15 | D | REQ-PREG-003 | High | Determinism is what prevents duplicate contacts between an offline-created pregnancy and the server |
| REQ-PREG-005 | Each contact's `dueAt = (edd − 280d) + weekTarget×7`, per `RULES.ancSchedule` (weeks 12/20/26/30/34/36/38/40) | backend.md §9.5, A.5 | F | REQ-PREG-004, REQ-RULES-001 | Med | |
| REQ-PREG-006 | Create `anc_due` reminders (1 day before `dueAt`, 09:00 Asia/Kathmandu) for every future contact, to patient phone **and** `emergencyContactPhone` if set | backend.md §9.5, A.5 reminders.anc_due | F | REQ-PREG-004, REQ-REMIND-001 | Med | |
| REQ-PREG-007 | Create `anc_missed` reminders (`dueAt + 3 days`, 09:00) status `pending` for every contact | backend.md §9.5, A.5 reminders.anc_missed | F | REQ-PREG-004 | Med | RULES text also says "repeat once after 7 days" — no module implements the repeat; see GAPS G2 |
| REQ-PREG-008 | `GET /pregnancies/:id` returns pregnancy + all 8 contacts + delivery (if any) + reminders | backend.md §9.5, A.4 | F | REQ-ROLE-003 | Low | |
| REQ-PREG-009 | `PATCH /pregnancies/:id` (version-checked) may update `birthPlan`, `riskFactors` (recomputing `riskLevel`), or `status=ended` | backend.md §9.5, A.4 | F | REQ-PREG-003 | Med | |
| REQ-PREG-010 | `PUT /pregnancies/:id/contacts/:contactNo`: `canAppendPatient`, `contactNo` in 1..8, contact must already exist | backend.md §9.5, A.4 | F | REQ-ROLE-004, REQ-PREG-004 | Med | |
| REQ-PREG-011 | `gaDays = gestationalAgeDays(edd, doneAt)`; `triage = triage(findings, dangerSigns, pregnancy, gaDays)` computed **server-side** from `rules/triage.ts` | backend.md §9.5 | F | REQ-RULES-002 | High | |
| REQ-PREG-012 | Saving a contact updates fields, increments version, and cancels any pending `anc_missed` reminder whose `refId` = this contact | backend.md §9.5 | F | REQ-PREG-007, REQ-PREG-010 | Med | |
| REQ-PREG-013 | Response includes `nearestReferral` = nearest facility with a birthing centre to the acting provider's facility | backend.md §9.5, §9.8 | F | REQ-FACILITY-001 | Low | |
| REQ-PREG-014 | Recording a contact logs `contact_recorded` | backend.md §9.5 | F | REQ-AUDIT-001 | Low | |
| REQ-PREG-015 | `POST /pregnancies/:id/delivery`: pregnancy must be `active` (else 422); creates the delivery, sets pregnancy `status=delivered`, cancels all pending reminders for the pregnancy | backend.md §9.5, A.4 | F | REQ-PREG-009 | Med | |
| REQ-RULES-001 | The 8-contact ANC schedule (`ancSchedule`), danger signs, risk factors, and triage logic are one shared, versioned `RULES` table served at `GET /rules`; both Dart and TypeScript implementations must be ported from it line-for-line | backend.md §9.5, §9.8, A.5; frontend.md §12 | D | - | High | Version must be bumped if the table content changes |
| REQ-RULES-002 | Triage evaluates in fixed priority order (red > amber > green); the 16 concrete rules and thresholds are specified verbatim in `A.5`/`A.6` (e.g. BP ≥160/110 → red; Hb <7 → red; fetal movement absent after 20 wk → red; `riskLevel=high` → amber) | backend.md A.5, A.6; frontend.md §12 | F | REQ-RULES-001 | High | |
| REQ-RULES-003 | 16 shared test cases (`A.6`) must pass identically on both the TS and Dart implementations before endpoints are wired up | backend.md §12, §14 rule 6; frontend.md §17 | T | REQ-RULES-002 | High | |
| REQ-RULES-004 | If the server-computed triage differs from the client's locally computed value, the client displays and stores the **server** value and logs a warning | backend.md §9.5; frontend.md S13, §12 | F | REQ-PREG-011 | Med | Documented as "should never happen if tests pass" |
| REQ-RULES-005 | Before the demo, verify the 8-contact schedule and danger-sign wording against the current DoHS/Family Welfare Division ANC protocol; update the table and bump its version if it differs | backend.md A.5 | NFR | REQ-RULES-001 | Med | Research task, not inferable from the docs alone |
| REQ-PREG-016 | Register-pregnancy button/route is hidden entirely unless `patient.sex == "female"` and no active pregnancy exists | frontend.md S11 | UX | REQ-PREG-001, REQ-PREG-002 | Low | |
| REQ-PREG-017 | Pregnancy dashboard (S12): week X of 40, EDD (BS/AD), risk chip, 8-contact stepper coloured by triage, "overdue" = `dueAt < today && doneAt == null` | frontend.md S12 | UX | REQ-PREG-008 | Low | |
| REQ-PREG-018 | ANC checklist screen (S13) expands only the fields listed in `RULES.ancSchedule[contactNo].checklist`, computes triage live client-side on every field change, and shows a referral card with a call button on amber/red | frontend.md S13 | UX | REQ-RULES-002 | Low | |
| REQ-PREG-019 | Record-delivery screen (S14) sets `pregnancy.status = delivered` locally to mirror the server | frontend.md S14 | F | REQ-PREG-015 | Low | |

## REMINDERS & SMS

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-REMIND-001 | Worker polls every 60 s for `pending` reminders with `dueAt <= now`, limit 100 per tick | backend.md §9.6 | F | - | Med | |
| REQ-REMIND-002 | `SmsAdapter` interface with two implementations: `MockSms` (writes to `mock_sms`) and `SparrowSms` (Sparrow REST API), selected by `SMS_MODE` | backend.md §3, §9.6, §5 | F | REQ-REMIND-001 | Med | Verify the current Sparrow API/token approval before relying on it |
| REQ-REMIND-003 | Failed sends retry on the next tick up to 3 times total, then marked `failed` | backend.md §9.6 | F | REQ-REMIND-001 | Med | |
| REQ-REMIND-004 | Message templates render Nepali + English text with a Bikram Sambat date conversion | backend.md §9.6 | F | - | Low | |
| REQ-REMIND-005 | `GET /patients/:id/reminders`: upcoming pending + last 20 sent | backend.md §9.6, A.4 | F | REQ-ROLE-003 | Low | |
| REQ-REMIND-006 | `GET /demo/sms` and `/demo/sms.html` exist only when `SMS_MODE=mock` (404 otherwise); the HTML page auto-refreshes every 3 s for a projector | backend.md §9.6, §9.8 | F | REQ-REMIND-002 | Low | Demo-only |
| REQ-REMIND-007 | `POST /demo/reminders/fire` (mock mode only) forces the next pending reminder for a patient to fire immediately, for live demos | backend.md §9.6 | F | REQ-REMIND-002 | Low | Demo-only |
| REQ-REMIND-008 | Reminders screen (S15) is read-only: kind icon, BS due date, recipient role, status chip | frontend.md S15 | UX | REQ-REMIND-005 | Low | |
| REQ-REMIND-009 | Reminder is server-owned and **not** syncable — the client only ever reads it, never writes it via the outbox | backend.md A.2 Reminder | D | - | Low | |

## SYNC (offline-first)

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-SYNC-001 | `POST /sync/push` accepts up to 50 changes; each is applied independently in its own transaction; the batch never fails wholesale | backend.md §9.7, A.4 | F | - | High | |
| REQ-SYNC-002 | `sync_ops` table de-duplicates by `opId`; a repeat `opId` returns `status:"duplicate"` with the previously stored result | backend.md §9.7 | F | REQ-SYNC-001 | High | |
| REQ-SYNC-003 | Per-table authorization on push: `patients` → owner; `visits` → `canAppend && role != fchv`; `documents` → `canAppend`, metadata only (client cannot set `status=uploaded`); `pregnancies`/`anc_contacts`/`deliveries` → `canAppend` | backend.md §9.7 | SEC | REQ-ROLE-004, REQ-ROLE-005 | High | |
| REQ-SYNC-004 | Append-only tables (`visits`, `deliveries`): existing id → idempotent return; otherwise create at version 1 | backend.md §9.7 | F | REQ-SYNC-001 | Med | |
| REQ-SYNC-005 | Versioned tables (`patients`, `documents`, `pregnancies`, `anc_contacts`): `baseVersion=0` + not-exists → create v1; `baseVersion != current.version` → `status:"conflict"` with `current`; else apply whitelisted fields and increment version | backend.md §9.7, A.3 | F | REQ-SYNC-001 | High | |
| REQ-SYNC-006 | `anc_contacts` sync-apply recomputes triage server-side and cancels reminders exactly as the `PUT` endpoint does | backend.md §9.7 | F | REQ-PREG-011, REQ-PREG-012 | High | |
| REQ-SYNC-007 | A `pregnancies` row created via sync (baseVersion 0, not-exists) runs the **same** creation logic as `POST /patients/:id/pregnancies`, including generating contacts and reminders | backend.md §9.7 | F | REQ-PREG-004 | High | |
| REQ-SYNC-008 | zod validation failure on a change → `status:"rejected"`, `error.code=VALIDATION_ERROR`; authorization failure → `rejected FORBIDDEN` | backend.md §9.7 | F | REQ-SYNC-001 | Med | |
| REQ-SYNC-009 | `GET /sync/pull?since&deviceId` returns rows updated after the cursor for patients the user may see (owned ∪ active grant), ordered `updatedAt asc`, page size 200, with `cursor`/`hasMore` | backend.md §9.7, A.4 | F | REQ-ROLE-003 | High | |
| REQ-SYNC-010 | `updatedAt` is always server-assigned (`@updatedAt`); the pull cursor relies on this | backend.md §9.7 | D | - | Med | |
| REQ-SYNC-011 | Deleted rows are returned by pull with `deleted=true` rather than omitted | backend.md §9.7 | D | REQ-PATIENT-012 | Low | |
| REQ-SYNC-012 | Client: every local write on a syncable table appends an outbox row `{opId, table, op, rowId, baseVersion, payload, createdAt}` | frontend.md §6.2, §7, A.8#1 | F | - | High | |
| REQ-SYNC-013 | SyncEngine runs on: connectivity change, app resume, manual "Sync now", and a 60 s foreground timer; guarded by a mutex so only one cycle runs at a time | frontend.md §7 | F | REQ-SYNC-012 | Med | |
| REQ-SYNC-014 | Outbox is pushed in `createdAt`-ordered batches of ≤50, recursing while a full batch was returned | frontend.md §7, A.8#2 | F | REQ-SYNC-012, REQ-SYNC-001 | Med | |
| REQ-SYNC-015 | Push results: `applied`/`duplicate` → replace local row with server row, delete outbox entry; `conflict` → replace local row with `current`, delete outbox entry, show a non-blocking "Updated from server" toast; `rejected` → keep the row flagged with the server's error message | frontend.md §7, A.8#3 | F | REQ-SYNC-005 | High | |
| REQ-SYNC-016 | Pull loop continues while `hasMore`; a row is upserted only if `incoming.version > local.version`; the new cursor is persisted after each page | frontend.md §7, A.8#4 | F | REQ-SYNC-009 | Med | |
| REQ-SYNC-017 | Pull must **not** overwrite a local row that still has a pending outbox operation — it is skipped and left for the push result to settle | frontend.md §7 | F | REQ-SYNC-016 | Med | |
| REQ-SYNC-018 | Rows with `version=0` and a pending outbox op show a "pending" cloud icon in the UI | frontend.md §7 | UX | REQ-SYNC-012 | Low | |
| REQ-SYNC-019 | Document upload sequence: `presign → PUT bytes → complete`; failure increments `upload_attempts`, giving up at 5 | frontend.md §7, S10 | F | REQ-DOC-003, REQ-DOC-004 | Med | |
| REQ-SYNC-020 | Client compares its clock against `serverTime` returned by the last push and warns the user if drift exceeds 5 minutes | frontend.md §7, A.8#6 | NFR | REQ-SYNC-001 | Low | |
| REQ-SYNC-021 | Sync status screen (S17): pending-op count, last sync time, manual "Sync now", list of failed ops with retry/discard | frontend.md S17 | UX | REQ-SYNC-012 | Low | |
| REQ-SYNC-022 | The app must be fully usable offline for everything **except** login, QR share/redeem, uploads, and audit | frontend.md §1 (golden rule) | NFR | REQ-SYNC-012..021 | High | Governing non-functional requirement for the whole client architecture |
| REQ-SYNC-023 | ANC contact ids are deterministic (`uuid v5`, fixed namespace, `pregnancyId + ":" + contactNo`) on **both** client and server so an offline-created pregnancy's 8 contacts never duplicate the server-generated set | backend.md A.8#5; frontend.md core/ids.dart | D | REQ-PREG-004 | High | Duplicate of REQ-PREG-004's determinism clause, listed here because it's also a sync-correctness requirement |

## FACILITIES, CODE LISTS, CONFIG

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-FACILITY-001 | `GET /facilities/nearby?lat&lng&birthing&limit`: Haversine distance, optional `hasBirthingCentre` filter, sorted, limited | backend.md §9.8, A.4 | F | REQ-SEED-001 | Low | |
| REQ-FACILITY-002 | Facility fields: name, type, hasBirthingCentre, phone, lat, lng, municipality (+`distanceKm` only in the nearby response) | backend.md §6, A.2 | D | - | Low | |
| REQ-CODELIST-001 | `GET /codelists?kind=` returns all picklist items, versioned, `Cache-Control: max-age=3600` | backend.md §9.8, A.4 | F | REQ-SEED-003 | Low | |
| REQ-CODELIST-002 | `CodeListItem`: `kind`, `code`, `labelEn`, `labelNp`, optional `meta`; primary key `(kind, code)` | backend.md §6, A.2 | D | - | Low | |
| REQ-META-001 | `GET /rules` serves the `RULES` object verbatim, versioned | backend.md §9.8, A.4 | F | REQ-RULES-001 | Low | |
| REQ-META-002 | `GET /config` exposes feature flags: `smsMode`, `aiSummaryEnabled`, `otpDemo`, `rulesVersion`, `codelistVersion` | backend.md §9.8, A.4 | F | - | Low | |

## AUDIT

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-AUDIT-001 | `AuditEntry` is written for: `grant_created`, `grant_redeemed`, `record_viewed`, `visit_added`, `contact_recorded`, `document_added`, `grant_revoked` | backend.md §6 enum `AuditAction` | D | - | Med | |
| REQ-AUDIT-002 | Audit rows are immutable — never soft-deleted or edited | backend.md §11 | SEC | REQ-AUDIT-001 | Med | |
| REQ-AUDIT-003 | Patient owner can view the full audit trail for their own record ("who viewed my record", S16) | backend.md §9.1; frontend.md S16 | F | REQ-PATIENT-010 | Low | |

## SEED / DEMO DATA

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-SEED-001 | Seed 4 facilities, 3 invite codes, 3 demo users (PIN 1234), 3 demo patients (Sita/Ram/Aarav), Ram's 4 visits with prescriptions, Sita's 1 visit, Sita's active pregnancy at week 30 with 3 green contacts done + contact 4 due + a pre-sent mock SMS, and one seeded document for Ram | backend.md §10 | F | - | Low | Demo depends entirely on this |
| REQ-SEED-002 | `npm run demo:reset` truncates all tables and reseeds, recomputing Sita's LMP relative to "today" so she is always at gestational week 30 | backend.md §10 | F | REQ-SEED-001 | Low | |
| REQ-SEED-003 | Seed code lists: 40 complaints, 60 ICD-10-style diagnoses, 50 essential drugs, plus danger-sign/risk-factor entries mirrored from `RULES` | backend.md §10 | D | REQ-RULES-001 | Low | |

## API CONTRACT (cross-cutting conventions)

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-API-001 | Global error handler maps every thrown `AppError` to `{ok:false, error:{code,message,details}}` with the HTTP status from the A.3 table | backend.md §11, A.3 | F | - | High | |
| REQ-API-002 | zod validation failures → 400 `VALIDATION_ERROR`, `details = {field: message}` mappable directly onto form fields | backend.md §11, A.1 | F | REQ-API-001 | Med | |
| REQ-API-003 | Unknown/unexpected errors → 500 `INTERNAL`; stack is logged, never leaked to the client | backend.md §11, A.3 | SEC | REQ-API-001 | High | |
| REQ-API-004 | Success envelope is always `{ok:true, data:{...}}` — `data` is always an object, never a bare array | backend.md A.1 | D | - | High | Governs every endpoint |
| REQ-API-005 | Every syncable entity carries an integer `version` and a server-assigned `updatedAt` | backend.md A.1 | D | - | High | |
| REQ-API-006 | Pagination is cursor-style everywhere (`before`/`since`/`cursor`), never page numbers | backend.md A.1 | F | - | Low | |
| REQ-API-007 | Every response goes through a per-entity serializer producing camelCase JSON with ISO date strings; raw Prisma objects are never returned | backend.md §8, §14 rule 9 | NFR | - | Med | |
| REQ-API-008 | Calendar dates are `YYYY-MM-DD` (AD only); timestamps are ISO 8601 UTC with milliseconds; the server never stores or returns Bikram Sambat | backend.md A.1 | D | - | Med | |

## SECURITY / NON-FUNCTIONAL

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-SEC-001 | Documented rate limits: OTP request 5/10min/phone; PIN login 10/15min/IP+phone; grant creation 20/hr/patient; global 300/min/IP | backend.md §11 | SEC | - | High | See AMBIGUITIES A2 for overlap with the 5-wrong-PIN lockout |
| REQ-SEC-002 | CORS is fully open (`CORS_ORIGINS=*`) — explicitly documented as hackathon-only, not a production setting | backend.md §5, §11 | SEC | - | Med | Flag before any real deployment |
| REQ-SEC-003 | Secure headers applied via `@fastify/helmet` | backend.md §11 | SEC | - | Low | |
| REQ-SEC-004 | PINs, OTPs, tokens, and raw message bodies are never logged at info level | backend.md §11 | SEC | REQ-USER-002 | High | |
| REQ-SEC-005 | PIN hashed with argon2id (cost parameter configurable); refresh tokens stored as an argon2 hash | backend.md §3, §7.1, §11 | SEC | REQ-AUTH-005, REQ-AUTH-011 | High | **Session 3 deviation, resolved:** refresh tokens are hashed with SHA-256, not argon2. `docs/DATA_MODEL.md`'s own `RefreshToken.tokenHash` is specified as "unique - the lookup key on /auth/refresh," which needs exact-match lookup; argon2's per-call random salt makes that structurally impossible (verify-only, never a `WHERE tokenHash = ?` unique-index lookup). A refresh token is already a high-entropy 256-bit random value, so a slow/memory-hard hash buys no real security margin, unlike the PIN (low-entropy, argon2id is correct there and unchanged). See `docs/TECH_DECISIONS.md`'s "Refresh-token hashing" entry. |

## I18N / UX CONVENTIONS

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-I18N-001 | All user-visible strings go through `en`/`ne` ARB files; default locale = device locale if `ne`/`en`, else `ne` | frontend.md §13, §19 | UX | - | Low | |
| REQ-I18N-002 | Dates display Bikram Sambat primary with AD secondary (`BsDateText` widget); pickers convert BS→AD before storage; storage is always AD | frontend.md §13 | UX | REQ-API-008 | Low | |
| REQ-UX-001 | Every list screen has loading/empty/error/offline states | frontend.md §16, §19 | UX | - | Low | |
| REQ-UX-002 | Writes never block on network: save locally, pop the screen, show "Saved · will sync" (or "Saved · synced" if pushed within 2 s) | frontend.md §16 | UX | REQ-SYNC-012 | Low | |
| REQ-UX-003 | A persistent `OfflineBanner` appears on provider screens when offline | frontend.md §16 | UX | - | Low | |
| REQ-UX-004 | Red triage banners use colour **and** an icon **and** text, for accessibility | frontend.md §16 | UX | REQ-RULES-002 | Low | |
| REQ-UX-005 | Minimum 48 dp tap targets; vitals entry uses large numeric steppers, never free-text typing | frontend.md §16 | UX | - | Low | |
| REQ-UX-006 | Provider summary always shows an allergies row, even "No known allergies" when the list is empty | frontend.md §16, S21 | UX | REQ-PATIENT-007 | Low | |

## TESTING (explicitly required by the docs)

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-TEST-001 | `test/rules.test.ts` — the 16 shared cases from A.6 must pass **before** wiring up endpoints | backend.md §12, §14 rule 6 | T | REQ-RULES-003 | High | |
| REQ-TEST-002 | `test/sync.test.ts` — idempotent create via push twice, conflict on an ANC contact, pull ordering and cursor behaviour | backend.md §12 | T | REQ-SYNC-004, REQ-SYNC-005, REQ-SYNC-009 | High | |
| REQ-TEST-003 | `test/grants.test.ts` — create → redeem → expired → already-redeemed → revoked, and the 24 h access window | backend.md §12 | T | REQ-GRANT-004, REQ-GRANT-005, REQ-GRANT-009 | High | |
| REQ-TEST-004 | A smoke script/test walks the full demo path end to end (login → patient → grant → redeem → visit → pregnancy → red contact → timeline/demo-SMS check) | backend.md §12 | T | Most of the above | Med | |
| REQ-TEST-005 | Frontend rules unit tests (`edd_test.dart`, `anc_schedule_test.dart`, `triage_test.dart`) mirror the same 16 A.6 cases | frontend.md §4, §17 | T | REQ-RULES-003 | High | |
| REQ-TEST-006 | Manual acceptance checklist: fresh-install flow, airplane-mode add-then-sync, cross-phone QR share/redeem, red-triage banner + referral + call button, document capture→upload, timeline BS-month grouping, audit list, language toggle, release APK on a real device | frontend.md §17 | T | Most of the above | Med | |

## MOCK API (frontend build-ahead-of-backend mode)

| ID | Requirement | Source | Type | Depends on | Risk | Notes |
|---|---|---|---|---|---|---|
| REQ-MOCK-001 | `core/net/mock_api.dart` implements every Part A endpoint in-memory, seeded from the Part A.2 examples, toggled via `--dart-define=MOCK_API=true`; kept working until the last hour as a live-demo fallback | frontend.md §15 | F | - | Low | |

---

## CONTRADICTIONS

**C1 — fchv and Visit creation.** `backend.md` states three separate times, consistently, that role `fchv` is blocked (403) from `POST /patients/:id/visits` and from the `visits` table on sync push (§7.3, §9.3, §9.7 — REQ-ROLE-005, REQ-VISIT-001, REQ-SYNC-003). `frontend.md` §Screens S22 lists the route's allowed roles as `provider (fchv: read-only, cannot prescribe)` and its Logic/validation says "fchv role: hide medicines section" — wording that implies fchv can open the add-visit screen and submit a visit without prescriptions, not that they are barred outright. The backend is internally consistent across three independent sections; the frontend line reads like a drafting slip, but it is a genuine conflict about what UI/route-guarding to build for the fchv role on this screen.

**C2 — Document object key vs. accepted content types.** `backend.md` §9.4 accepts `contentType` of either `image/jpeg` or `image/png` at `POST /documents/presign`, but the very same section hard-codes the generated object key as `patients/{patientId}/{documentId}.jpg` regardless of which content type was accepted. A PNG upload would be stored under a `.jpg` key with a mismatched extension.

**C3 — CLAUDE.md's placeholder stack vs. the actual product stack.** `CLAUDE.md` line 7-9 assumes "Python 3.12 + FastAPI + PostgreSQL + SQLAlchemy 2.x + Alembic + pytest" for every section marked `[stack]` (coding standards §7, database rules §9, testing rules §10). The actual, fully-specified backend stack in `backend.md` §3 is Node 20 + TypeScript + Fastify 4 + Prisma 5 + PostgreSQL 16 + Redis 7/BullMQ + MinIO + zod + jose + argon2 + pino + vitest — a completely different runtime and toolchain. This is not a genuine ambiguity: `CLAUDE.md` itself anticipates the mismatch and instructs "rewrite those sections during Session 1 and delete this note." Flagged here only so Session 1 does not skip that rewrite.

**C4 — `demoOtp`'s gating flag (found in Session 3).** `backend.md` §7.1 step 1 gates the fixed `123456` code and the `demoOtp` response field on `OTP_MODE=demo`. §5's env table and `REQ-META-002`'s `config.otpDemo` flag (which frontend.md S02 keys its "show demoOtp banner" UI off) agree with this. But `backend.md` A.4's endpoint documentation for `POST /auth/otp/request` instead says "`demoOtp` present only when `SMS_MODE=mock`" - a different, independent env var. Resolved on `OTP_MODE=demo` (REQ-AUTH-003's Notes column) since three of the four mentions agree and it's the more conservative reading for a hypothetical `OTP_MODE=real, SMS_MODE=mock` deployment.

## AMBIGUITIES

**A1 — Forgot-PIN / PIN reset.** `frontend.md` S04 has a "Forgot PIN → re-verify OTP" link, implying a full PIN-reset flow. `backend.md` §7.1 step 3 describes `POST /auth/pin/set` as "create user **if missing**... set PIN," which reads as first-time setup. It's unclear whether the same endpoint is meant to overwrite an existing user's `pinHash` when reached via the forgot-PIN path, or whether a distinct reset mechanism is needed.

**A2 — Two PIN-login rate limits.** `backend.md` §11 documents a global limit of "10/15 min/IP+phone" on `/auth/pin/login`; §7.1 step 4 separately documents "5 failures → lock 15 min (Redis key)" as an account-level lockout. The doc never states whether these are the same control described twice with different numbers, or two independent, stacked limits.

**A3 — Related to C1**: even setting the route-guard question aside, it's unclear whether `fchv` should be able to *navigate to* `/provider/patient/:id/visit/new` at all (read-only view of past visits?) given the backend flatly rejects any write from that role.

**A4 — Printed long-lived QR semantics.** `backend.md` A.7 gives the printed card a token `exp` of `ttlMinutes = 525600` (1 year) but doesn't clarify whether `accessUntil` after redeeming it is still the usual +24h window, or something longer/different given the token's own long lifetime.

**A5 — Sync-push semantics for `documents`.** `backend.md` §9.7 says the `documents` table is syncable "meta only; status cannot be set to uploaded by client," but never lists which document fields are actually writable via a sync `upsert` op (title? takenAt? type?) versus only ever being created through `presign`/`complete`.

## GAPS

**G1 — Error-code table incompleteness.** `A.3` lists 429 `RATE_LIMITED` as "OTP or grant creation too frequent," but does not mention the PIN-login lockout (§7.1 step 4 / §11) as another 429 trigger, leaving the client's error-mapping table (frontend.md §8) without an explicit code path for that case.

**G2 — `anc_missed` repeat-after-7-days is unimplemented.** `RULES.reminders.anc_missed` in A.5 states "repeat once after 7 days," but the pregnancy-creation logic (§9.5) only ever creates a single `anc_missed` reminder per contact, and the worker (§9.6) has no logic to generate the second occurrence.

**G3 — No soft-delete write path exists anywhere.** Every syncable entity carries a `deleted` boolean, and the sync-pull protocol explicitly handles `deleted=true` rows, but no endpoint in Part A.4, and no module spec in backend.md §9, ever sets `deleted=true` on any entity. It's unclear whether any user-facing delete/archive feature is actually in scope for this build.

**G4 — No rate limit documented for `/documents/presign` or `/documents/:id/complete`.** REQ-SEC-001's rate-limit list covers OTP, PIN login, and grants, but not the upload endpoints, despite them being a plausible abuse/cost vector (storage writes).

**G5 — (cross-referenced from REQ-PATIENT-012) — soft-delete filtering is mandated by CLAUDE.md testing rules but there is no requirement describing *when* a row should become `deleted=true` in the first place**, since G3 means the trigger for soft-delete is undocumented.

## ASSUMPTIONS

**AS1 — No existing git repository.** The working directory has no `.git`. This is treated as intentional for a fresh hackathon build — Session 2 will run `git init`/`git checkout -b backend-build` per `SESSION_PROMPTS.md`'s setup block. *If wrong* (i.e. this was meant to be layered onto existing history elsewhere), work in later sessions would start from the wrong baseline.

**AS2 — Object-level authorization is universal.** `canReadPatient`/`canAppendPatient` are explicitly named as the gate for only a subset of endpoints in backend.md §9.1–§9.5, but the pattern is applied consistently enough (and restated for `sync` in §9.7) that this ledger assumes they gate **every** patient-scoped read/write, including ones not explicitly re-stated per endpoint (e.g. `GET /patients/:id/reminders`, `GET /documents/:id`). *If wrong*, some endpoint could be under-protected and would need a dedicated authorization test added in Session 3/6 security review.

**AS3 — 32-hour-plan tables (backend.md §13, frontend.md §18) are scheduling guidance, not requirements**, and are therefore excluded from the ledger's REQ IDs. *If wrong* and the hour budget is itself a hard constraint the team is tracking against, it should be re-added as an explicit non-functional requirement with its own ID.

**AS4 — Tier 2/Tier 3 features (delivery endpoint's Tier 2 status doesn't apply — delivery is Tier 1; actual Tier 2/3 items are: AI summary worker, Sparrow SMS adapter, printed long-lived QR, admin stats endpoint, DHIS2/HMIS export, NID verification, council registration check, FCM push) are recorded in the ledger but are assumed lower-priority and may be marked `BLOCKED`/deferred without needing a question, per the Feature Tiers table in backend.md §2.2 and frontend.md §2.2. *If wrong* and a Tier 2/3 item is actually demo-critical, it needs to be promoted explicitly before Session 4/5.
