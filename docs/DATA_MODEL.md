# Data Model — Swasthya Card

PostgreSQL 16 via Prisma 5 (see `docs/TECH_DECISIONS.md`). Column names are `snake_case` via `@map`; JSON keys stay camelCase in the API layer per `backend.md` A.1. This document extends the schema literally specified in `backend.md` §6 with the constraint/index/cascade reasoning CLAUDE.md §9 requires, and folds in the Session 0/1 resolutions (Q3, Q4).

## 1. Soft-delete policy

Every syncable entity carries `deleted Boolean @default(false)`. Per **Question 4** (resolved Option A): the column exists and every read-path query filters it (`WHERE deleted = false`), because the sync-pull contract (REQ-SYNC-011) requires the field to exist and behave correctly if it is ever set — but **no service in this build ever sets it to `true`**. There is no delete/archive endpoint or UI action in scope. If this changes, the column and its indexes are already in place; only a new service method is needed.

## 2. Cascade policy

Every foreign key uses `onDelete: Restrict`. Rationale: hard deletes are not a supported operation anywhere in this system (see §1) — the only lifecycle event is soft-delete, which does not touch foreign keys at all. `Restrict` is the safe default that turns any accidental hard-delete attempt (e.g. an ad-hoc admin SQL statement) into a loud failure instead of silently cascading away clinical history. There is no case in the requirements where a parent's hard deletion should ever ripple to children, so no exception is carved out.

## 3. Enums

| Enum | Values | Used by |
|---|---|---|
| `Role` | `patient`, `provider`, `fchv`, `admin` | `User.role` |
| `Sex` | `female`, `male`, `other` | `Patient.sex`, `Delivery.babySex` |
| `GrantScope` | `read`, `append` | `AccessGrant.scope` |
| `DocType` | `prescription`, `lab`, `discharge`, `referral`, `other` | `Document.type` |
| `DocStatus` | `pending_upload`, `uploaded` | `Document.status` |
| `AiStatus` | `none`, `queued`, `done`, `failed` | `Document.aiSummaryStatus` |
| `PregStatus` | `active`, `delivered`, `ended` | `Pregnancy.status` |
| `RiskLevel` | `normal`, `high` | `Pregnancy.riskLevel` |
| `Triage` | `green`, `amber`, `red` | `AncContact.triageLevel` |
| `DeliveryPlace` | `home`, `birthing_centre`, `hospital`, `on_the_way` | `Delivery.place` |
| `DeliveryMode` | `normal`, `assisted`, `cs` | `Delivery.mode` |
| `Outcome` | `live_birth`, `stillbirth` | `Delivery.outcome` |
| `ReminderKind` | `anc_due`, `anc_missed`, `follow_up`, `medicine` | `Reminder.kind` |
| `Channel` | `sms`, `push` | `Reminder.channel` |
| `ReminderStatus` | `pending`, `sent`, `failed`, `cancelled` | `Reminder.status` |
| `AuditAction` | `grant_created`, `grant_redeemed`, `record_viewed`, `visit_added`, `contact_recorded`, `document_added`, `grant_revoked` | `AuditEntry.action` |
| `FacilityType` | `health_post`, `phcc`, `hospital`, `birthing_centre` | `Facility.type` |

## 4. Entities

### User (REQ-USER-001/002, REQ-AUTH-*)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | `@default(uuid())` |
| phone | string | **unique**, E.164 |
| pinHash | string? | argon2id hash, nullable until PIN set |
| role | Role | default `patient` |
| name | string | |
| facilityId | uuid? FK → Facility | `onDelete: Restrict` |
| createdAt | timestamptz | `@default(now())` |

Indexes: PK on `id`; unique on `phone` (login lookup, REQ-AUTH-001). No index on `role`/`facilityId` — user table is small (dozens, not millions, for a district-scale deployment) and neither is queried standalone.

### RefreshToken (REQ-AUTH-011)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | |
| userId | uuid FK → User | `onDelete: Restrict` |
| tokenHash | string | **unique** — the lookup key on `/auth/refresh` |
| expiresAt | timestamptz | |
| revokedAt | timestamptz? | |

**Added index (not in `backend.md`'s literal schema):** `@@index([userId])` — needed to revoke all of a user's refresh tokens on a PIN reset (Question 2) or a detected refresh-token reuse, per standard rotation hygiene; without it, revocation-by-user is a full table scan.

**Hash algorithm (Session 3):** `tokenHash` is SHA-256, not argon2 despite REQ-SEC-005's literal wording — this column's own "unique, the lookup key" constraint requires exact-match lookup, which argon2's random-salt-per-call design cannot support. See `docs/TECH_DECISIONS.md`'s "Refresh-token hashing" entry.

### OtpCode (REQ-AUTH-002/003)
| Field | Type | Constraint |
|---|---|---|
| phone | string PK | one live OTP per phone at a time, by design |
| code | string | |
| expiresAt | timestamptz | |
| attempts | int | default 0, max 5 (REQ-AUTH-004) |

### InviteCode (REQ-AUTH-008/013)
| Field | Type | Constraint |
|---|---|---|
| code | string PK | |
| role | Role | |
| facilityId | uuid FK → Facility | `onDelete: Restrict` |
| usedByUserId | uuid? FK → User | `onDelete: Restrict` — nullable, may stay reusable per seed data |

### Patient (REQ-PATIENT-*)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | **client-generated** (REQ-PATIENT-001) |
| ownerUserId | uuid FK → User | `onDelete: Restrict` |
| name | string | |
| sex | Sex | |
| dob | date | AD only |
| bloodGroup | string? | |
| ward | int? | |
| municipality | string? | |
| allergies | json | `string[]`, default `[]` |
| chronicConditions | json | `string[]`, default `[]` |
| emergencyContactPhone | string? | |
| version | int | default 1, optimistic concurrency (REQ-PATIENT-003) |
| updatedAt | timestamptz | `@updatedAt` — sync cursor field |
| deleted | boolean | default false (§1) |

Indexes: `@@index([ownerUserId])` — `GET /patients` owned-list (REQ-ROLE-007). `@@index([updatedAt])` — sync-pull cursor scan (REQ-SYNC-009).

### AccessGrant (REQ-GRANT-*)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | server-generated |
| patientId | uuid FK → Patient | `onDelete: Restrict` |
| scope | GrantScope | |
| tokenJti | string | **unique** — the JWT `gid` claim, looked up on redeem |
| expiresAt | timestamptz | |
| redeemedByUserId | uuid? FK → User | `onDelete: Restrict` |
| redeemedAt | timestamptz? | |
| accessUntil | timestamptz? | set on redeem, +24h (REQ-GRANT-006) |
| revokedAt | timestamptz? | |
| createdAt | timestamptz | `@default(now())` |

Indexes: `@@index([patientId, redeemedByUserId, accessUntil])` — the exact tuple `canReadPatient`/`canAppendPatient` filter on (REQ-ROLE-003/004), on every authorized request.

### Visit (REQ-VISIT-*)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | client-generated |
| patientId | uuid FK → Patient | `onDelete: Restrict` |
| providerUserId | uuid FK → User | `onDelete: Restrict` |
| providerName | string | denormalised (REQ-VISIT-003) |
| facilityId | uuid? FK → Facility | `onDelete: Restrict` |
| facilityName | string? | denormalised |
| visitAt | timestamptz | |
| chiefComplaintCode | string | FK-by-convention to `CodeListItem(kind='complaint')` — not a DB FK (see §5) |
| vitals | json | object, default `{}` |
| diagnosisCodes | json | `string[]`, default `[]` |
| notes | string? | ≤1000 chars, enforced at the zod layer |
| advice | string? | |
| followUpAt | date? | |
| referral | json? | |
| prescriptions | json | embedded `Prescription[]`, default `[]` |
| supersedesId | uuid? | self-referential by convention, not an FK (a corrected visit may reference a visit that predates this constraint set) |
| version | int | default 1 |
| updatedAt | timestamptz | `@updatedAt` |
| deleted | boolean | default false |

Indexes: `@@index([patientId, visitAt])` — timeline + list-visits ordering (REQ-VISIT-007, REQ-PATIENT-008). `@@index([updatedAt])` — sync cursor.

### Document (REQ-DOC-*)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | client-generated |
| patientId | uuid FK → Patient | `onDelete: Restrict` |
| uploadedByUserId | uuid FK → User | `onDelete: Restrict` |
| type | DocType | |
| title | string | |
| takenAt | date | |
| status | DocStatus | default `pending_upload` |
| objectKey | string | `patients/{patientId}/{documentId}.jpg` — **Question 3, resolved A**: extension is always `.jpg` because only `image/jpeg` is accepted |
| contentType | string | always `"image/jpeg"` per Question 3 |
| aiSummary | string? | |
| aiSummaryStatus | AiStatus | default `none` |
| version | int | default 1 |
| updatedAt | timestamptz | `@updatedAt` |
| deleted | boolean | default false |

Indexes: `@@index([patientId])`, `@@index([updatedAt])` (sync cursor).

**Check constraint (raw SQL added to the migration, since Prisma's schema DSL has no `CHECK` clause):** none required — `sizeBytes ≤ 2 MB` (REQ-DOC-001) is enforced at the presign request boundary (zod), not stored on the row, so there is nothing to constrain in the table itself.

### Pregnancy (REQ-PREG-*)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | client-generated |
| patientId | uuid FK → Patient | `onDelete: Restrict` |
| lmp | date? | |
| edd | date | |
| gravida | int | |
| para | int | |
| riskFactors | json | `string[]`, default `[]` |
| riskLevel | RiskLevel | default `normal` |
| status | PregStatus | default `active` |
| birthPlan | json? | |
| registeredByUserId | uuid FK → User | `onDelete: Restrict` |
| version | int | default 1 |
| updatedAt | timestamptz | `@updatedAt` |
| deleted | boolean | default false |

Indexes: `@@index([patientId, status])`, `@@index([updatedAt])`.

**Partial unique index (raw SQL, hand-added to the generated migration file):**
```sql
CREATE UNIQUE INDEX pregnancies_one_active_per_patient
  ON pregnancies (patient_id)
  WHERE status = 'active' AND deleted = false;
```
This is the DB-level enforcement of REQ-PREG-002 ("no second active pregnancy"). A Prisma `@@unique` cannot express a partial (filtered) constraint, and an application-only check (`SELECT` then `INSERT` inside a transaction) is still race-prone under Postgres's default `READ COMMITTED` isolation without this index — two concurrent requests could both pass the read-check before either commits. The service-layer check (REQ-PREG-002) stays in place too, purely to return a clean 422 `RULE_VIOLATION` instead of surfacing a raw unique-violation error to the client; the index is the actual guarantee.

### AncContact (REQ-PREG-*, REQ-RULES-*)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | deterministic: `uuidv5(pregnancyId + ":" + contactNo)` (REQ-PREG-004, REQ-SYNC-023) |
| pregnancyId | uuid FK → Pregnancy | `onDelete: Restrict` |
| contactNo | int | **1..8**, see check constraint below |
| weekTarget | int | |
| dueAt | date | |
| doneAt | timestamptz? | |
| providerUserId | uuid? FK → User | `onDelete: Restrict` |
| findings | json? | |
| dangerSigns | json | `string[]`, default `[]` |
| triageLevel | Triage? | |
| triageReasons | json | `string[]`, default `[]` |
| referral | json? | |
| version | int | default 1 |
| updatedAt | timestamptz | `@updatedAt` |
| deleted | boolean | default false |

Constraints: `@@unique([pregnancyId, contactNo])` (already in `backend.md`'s schema — prevents a duplicate contact number, backs REQ-PREG-010's "contact must exist" lookup). Indexes: `@@index([updatedAt])`.

**Check constraint (raw SQL added to the migration):**
```sql
ALTER TABLE anc_contacts ADD CONSTRAINT anc_contacts_contact_no_range CHECK (contact_no BETWEEN 1 AND 8);
```
Direct DB enforcement of REQ-PREG-010's `contactNo` range, matching CLAUDE.md §9 ("check constraints declared at the database level, not only in app code").

### Delivery (REQ-PREG-015)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | client-generated |
| pregnancyId | uuid FK → Pregnancy | **unique** (one delivery per pregnancy), `onDelete: Restrict` |
| deliveredAt | timestamptz | |
| place | DeliveryPlace | |
| mode | DeliveryMode | |
| outcome | Outcome | |
| babyWeightKg | float? | |
| babySex | Sex? | |
| complications | json | `string[]`, default `[]` |
| version | int | default 1 |
| updatedAt | timestamptz | `@updatedAt` |
| deleted | boolean | default false |

The `pregnancyId @unique` constraint is the DB-level backing for REQ-PREG-015's "pregnancy must be active" rule combined with "one delivery closes it" — a second delivery attempt on the same pregnancy fails at the DB regardless of the service-layer `status=active` check.

### Reminder (REQ-REMIND-*) — server-owned, not syncable
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | `@default(uuid())` |
| patientId | uuid FK → Patient | `onDelete: Restrict` |
| pregnancyId | uuid? FK → Pregnancy | `onDelete: Restrict` |
| refId | uuid? | ANC-contact id or visit id, by convention — not an FK (points into two different tables) |
| kind | ReminderKind | |
| dueAt | timestamptz | |
| channel | Channel | default `sms` |
| recipientPhone | string | |
| recipientRole | string | |
| messageNp | string | |
| messageEn | string | |
| status | ReminderStatus | default `pending` |
| sentAt | timestamptz? | |

Indexes: `@@index([status, dueAt])` — the worker's poll query (REQ-REMIND-001), already in `backend.md`. **Added index (not in `backend.md`'s literal schema):** `@@index([patientId])` — required by `GET /patients/:id/reminders` (REQ-REMIND-005), which has no other index to use without one; its absence in the original schema would force a full-table scan as reminder volume grows.

### Facility (REQ-FACILITY-*)

**Schema built in Session 3, not Phase 1 (where this row still lives in `docs/PROJECT_PLAN.md`):** `User.facilityId` and `InviteCode.facilityId` are both FKs into this table, so it has to exist before either of those tables can be migrated. Only the columns below are built now — `GET /facilities/nearby`, the Haversine query, and seed data are still Phase 1/NOT_STARTED.

| Field | Type | Constraint |
|---|---|---|
| id | string PK | seeded, human-readable (`f_0001`) |
| name | string | |
| type | FacilityType | |
| hasBirthingCentre | boolean | |
| phone | string? | |
| lat, lng | float | |
| municipality | string | |

No index beyond the PK: the nearby-facilities query (REQ-FACILITY-001) computes Haversine over ≤200 rows per `backend.md` §9.8's own note — a spatial index (PostGIS/`earthdistance`) is a dependency with no requirement behind it at this scale.

### AuditEntry (REQ-AUDIT-*) — immutable
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | |
| patientId | uuid FK → Patient | `onDelete: Restrict` |
| actorUserId | uuid FK → User | `onDelete: Restrict` |
| actorName | string | denormalised |
| actorFacilityName | string? | denormalised |
| action | AuditAction | |
| grantId | uuid? | not an FK — a grant may be long gone while its audit trail must remain |
| at | timestamptz | `@default(now())` |

No `deleted` field — REQ-AUDIT-002 requires audit rows to be immutable and undeletable by design, not merely soft-deletable. Indexes: `@@index([patientId, at])` — `GET /patients/:id/audit`, newest-first (REQ-AUDIT-003).

### CodeListItem (REQ-CODELIST-*)
| Field | Type | Constraint |
|---|---|---|
| kind | string | part of composite PK |
| code | string | part of composite PK |
| labelEn, labelNp | string | |
| meta | json? | |

`@@id([kind, code])`. No separate index needed — the dataset is ~150 seeded rows (REQ-SEED-003), read wholesale by `GET /codelists`.

### SyncOp (REQ-SYNC-002)
| Field | Type | Constraint |
|---|---|---|
| opId | string PK | client-generated, the idempotency key |
| deviceId | string | |
| userId | string | |
| status | string | `applied`/`conflict`/`rejected`/`duplicate` |
| resultJson | json | the stored response, replayed verbatim on a duplicate `opId` |
| createdAt | timestamptz | `@default(now())` |

No secondary index added: `opId` lookups are the only query pattern this table serves.

### MockSms (REQ-REMIND-002/006)
| Field | Type | Constraint |
|---|---|---|
| id | uuid PK | |
| to | string | |
| text | string | |
| sentAt | timestamptz | `@default(now())` |

Demo-only table; no index beyond PK (`GET /demo/sms` reads the last 50 by `sentAt`, a small table by construction).

## 5. Non-enforced references (documented, not FKs)

Two fields are deliberately **not** database foreign keys even though they conceptually point at another row:

- `Visit.chiefComplaintCode` / `Visit.diagnosisCodes[]` / prescription `drugCode` → `CodeListItem` — validated at the **application** layer (REQ-VISIT-004: "codes must exist in the codelist, else 400"), not the database, because `CodeListItem`'s PK is composite (`kind, code`) and a single-column FK can't express "this string must exist as a `(kind='diagnosis', code=X)` row." Enforcing it in the service layer, in the same place the 400 response is already produced, is simpler than a composite-FK workaround with no behavioural difference.
- `Reminder.refId` → either `AncContact.id` or `Visit.id` depending on `kind` — a polymorphic reference. Postgres has no native polymorphic FK; enforcing it would require a trigger or a check-per-kind, which nothing in the requirements calls for (reminders are read-only from the client's perspective and only ever created by trusted server-side code, REQ-REMIND-009).

## 6. Entity-Relationship Diagram

```mermaid
erDiagram
    USER ||--o{ PATIENT : owns
    USER ||--o{ REFRESH_TOKEN : has
    USER }o--|| FACILITY : "works at (nullable)"
    FACILITY ||--o{ INVITE_CODE : issues
    FACILITY ||--o{ USER : employs

    PATIENT ||--o{ ACCESS_GRANT : "shared via"
    PATIENT ||--o{ VISIT : has
    PATIENT ||--o{ DOCUMENT : has
    PATIENT ||--o{ PREGNANCY : has
    PATIENT ||--o{ REMINDER : receives
    PATIENT ||--o{ AUDIT_ENTRY : "audited on"

    PREGNANCY ||--o{ ANC_CONTACT : schedules
    PREGNANCY ||--o| DELIVERY : "closed by"
    PREGNANCY ||--o{ REMINDER : triggers

    USER ||--o{ VISIT : records
    USER ||--o{ DOCUMENT : uploads
    USER ||--o{ ACCESS_GRANT : redeems
    USER ||--o{ AUDIT_ENTRY : performs

    USER {
        uuid id PK
        string phone UK
        string pinHash
        Role role
        uuid facilityId FK
    }
    PATIENT {
        uuid id PK
        uuid ownerUserId FK
        string name
        Sex sex
        int version
        bool deleted
    }
    ACCESS_GRANT {
        uuid id PK
        uuid patientId FK
        GrantScope scope
        string tokenJti UK
        timestamp accessUntil
    }
    VISIT {
        uuid id PK
        uuid patientId FK
        uuid providerUserId FK
        json prescriptions
        int version
    }
    DOCUMENT {
        uuid id PK
        uuid patientId FK
        DocStatus status
        string objectKey
    }
    PREGNANCY {
        uuid id PK
        uuid patientId FK
        date edd
        RiskLevel riskLevel
        PregStatus status
    }
    ANC_CONTACT {
        uuid id PK
        uuid pregnancyId FK
        int contactNo
        Triage triageLevel
    }
    DELIVERY {
        uuid id PK
        uuid pregnancyId FK UK
        Outcome outcome
    }
    REMINDER {
        uuid id PK
        uuid patientId FK
        uuid pregnancyId FK
        ReminderStatus status
    }
    AUDIT_ENTRY {
        uuid id PK
        uuid patientId FK
        uuid actorUserId FK
        AuditAction action
    }
    FACILITY {
        string id PK
        string name
        FacilityType type
    }
    REFRESH_TOKEN {
        uuid id PK
        uuid userId FK
        string tokenHash UK
    }
```
`CodeListItem`, `SyncOp`, `MockSms`, `OtpCode`, and `InviteCode` are omitted from the diagram — they have no meaningful relationship arrows (they're either reference/lookup tables or keyed standalone by a natural key) and would only add clutter; they are fully specified in §4.

## 7. Coverage — entity → requirements served

| Entity | REQ IDs served | Zero-requirement check |
|---|---|---|
| User | REQ-USER-001/002, REQ-AUTH-001..017 | serves 17+ reqs — kept |
| RefreshToken | REQ-AUTH-007, REQ-AUTH-011 | kept |
| OtpCode | REQ-AUTH-002..004 | kept |
| InviteCode | REQ-AUTH-008, REQ-AUTH-013 | kept |
| Patient | REQ-PATIENT-001..015, REQ-ROLE-003/004/007 | kept |
| AccessGrant | REQ-GRANT-001..012, REQ-ROLE-003/004/008 | kept |
| Visit | REQ-VISIT-001..011, REQ-PATIENT-005..007 | kept |
| Document | REQ-DOC-001..011 | kept |
| Pregnancy | REQ-PREG-001..019, REQ-RULES-001..005 | kept |
| AncContact | REQ-PREG-005/010..014/016..019, REQ-RULES-002..004 | kept |
| Delivery | REQ-PREG-015/019 | kept |
| Reminder | REQ-REMIND-001..009, REQ-PREG-006/007/012/015, REQ-VISIT-005 | kept |
| Facility | REQ-FACILITY-001/002, REQ-PREG-013 | kept |
| AuditEntry | REQ-AUDIT-001..003, REQ-ROLE-006 | kept |
| CodeListItem | REQ-CODELIST-001/002, REQ-VISIT-004, REQ-SEED-003 | kept |
| SyncOp | REQ-SYNC-001/002 | kept |
| MockSms | REQ-REMIND-002/006 | kept |

No table serves zero requirements — none deleted.
