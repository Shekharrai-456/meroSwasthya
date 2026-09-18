Swasthya Card — Backend Specification
Node.js + TypeScript + PostgreSQL API · sync target, rules validator, reminders · 32-hour hackathon build
Owner: backend developer
Counterpart document: Swasthya Card — Frontend Specification (Flutter)
Contract version: 2026-09-18.1
Generated: 18 September 2026
 
Contents
Contents	1
1. Purpose of this document	1
2. Product summary	1
2.1 What the backend is responsible for	1
2.2 Feature tiers	1
3. Technology stack	1
4. Project structure	1
5. Environment and infrastructure	1
6. Database schema (Prisma)	1
7. Authentication and authorisation	1
7.1 Flow	1
7.2 Tokens	1
7.3 Authorisation helpers	1
8. Serializers (the single place that produces API JSON)	1
9. Module specifications	1
9.1 Patients	1
9.2 Grants	1
9.3 Visits	1
9.4 Documents	1
9.5 Maternal	1
9.6 Reminders and SMS	1
9.7 Sync	1
9.8 Facilities, code lists, meta	1
10. Seed data (prisma/seed.ts) — the demo depends on this	1
11. Error handling, validation, security	1
12. Testing	1
13. 32-hour plan (backend)	1
14. Instructions for an AI coding agent	1
Part A — Shared API contract (identical in both documents)	1
A.1 Conventions	1
A.2 Entities (the exact JSON shapes)	1
A.3 Error codes	1
A.4 Endpoints	1
A.5 Shared rules (RULES) — implemented in Dart AND TypeScript from this table	1
A.6 Shared test cases (both sides must pass)	1
A.7 QR payload format	1
A.8 Sync protocol (summary shared by both sides)	1

 
1. Purpose of this document
This is the complete build specification for the backend. The frontend developer builds the Flutter app in parallel from a sister document whose Part A (API contract) is byte-identical to Part A here. If you need to change any request or response, change the shared contract file, regenerate both documents, and tell the frontend developer — never change a shape silently.
The backend is a sync target, a rules validator and a notification engine. It is NOT the source of truth for the UI: the app keeps a local database and pushes/pulls. Design every write to be idempotent and every read to be cheap.
2. Product summary
Swasthya Card is a patient-owned, offline-first health record for rural Nepal with a maternal-care module. Patients hold the record on their phone, share it with any health worker through a 10-minute QR grant, and see an audit of who looked. Health workers record structured visits, photograph paper records, and run the antenatal checklist with rule-based danger-sign triage. SMS reminders reach feature phones.
2.1 What the backend is responsible for
•	Authentication (phone + OTP + PIN), roles, invite codes for providers.
•	Persisting all entities; enforcing ownership and grant-based access; audit log.
•	Sync endpoints with per-op idempotency and version conflicts.
•	Maternal rules: EDD, 8-contact schedule with deterministic ids, triage (same table as the app), risk level.
•	Reminder generation and delivery (SMS mock/Sparrow), including cancellation when a contact is done.
•	Object storage presigned upload/download for documents; optional AI summary worker.
•	Read models: patient summary, unified timeline, nearby facilities, code lists, rules, config.
•	Seed data for the demo and a one-command reset.
2.2 Feature tiers
Tier	Backend scope
1 — must	Auth; patients; grants; visits; sync push/pull; pregnancies + contacts + triage; reminders worker with mock SMS page; documents presign/complete; timeline + summary; audit; codelists/rules/config; facilities nearby; seed + reset
2 — if time	Delivery endpoint; AI summary worker; Sparrow SMS adapter; printed long-lived QR with PIN; admin stats endpoint (pregnancies by trimester, overdue contacts)
3 — roadmap	DHIS2/HMIS export; NID verification; council registration check; push notifications (FCM)

3. Technology stack
Concern	Choice	Notes
Runtime / language	Node 20 LTS, TypeScript 5 (strict)	tsx for dev, tsc for build
HTTP	Fastify 4	Fast, schema-friendly; plugins: @fastify/cors, @fastify/rate-limit, @fastify/static
Validation	zod	One schema per request; infer types
ORM	Prisma 5 + PostgreSQL 16	Schema in Section 6
Auth	jose (JWT HS256), argon2 (PIN hash)	Separate secrets for access tokens and grant tokens
Queues / scheduling	BullMQ + Redis 7	reminders (repeat every 60 s), ai-summary
Storage	MinIO via @aws-sdk/client-s3 + s3-request-presigner	Same code works on AWS S3 later
SMS	Adapter interface: MockSms | SparrowSms	Sparrow SMS REST API (Nepal); verify token/sender-ID approval early
AI (optional)	Anthropic Messages API with an image block	Prompt: summarise the document in Nepali + English, list medicines with doses, mark uncertainty
Logging	pino + pino-pretty (dev)	
Tests	vitest + supertest (light)	Rules tests mandatory; endpoint smoke tests
Infra	docker-compose: postgres, redis, minio	API runs on host with tsx for fast reload
Tunnel	cloudflared or ngrok	Phones reach the laptop

4. Project structure
backend/
  docker-compose.yml
  .env.example
  package.json            // scripts: dev, build, start, migrate, seed, test, demo:reset
  prisma/schema.prisma
  prisma/seed.ts
  src/
    server.ts             // build Fastify app, register plugins & routes, start
    app.ts                // buildApp() for tests
    config.ts             // env parsing with zod
    plugins/
      envelope.ts         // reply.ok(data) helper + global error handler → { ok:false, error }
      auth.ts             // verifies Bearer JWT, sets request.user; requireRole(); requireGrant()
      ratelimit.ts
    lib/
      ids.ts              // ancContactId(pregnancyId, contactNo) uuid v5
      dates.ts            // toDateOnly(), toIso(), Kathmandu 09:00 helper
      serializers.ts      // toPatientDto(), toVisitDto(), ... (Section 8)
      errors.ts           // AppError class + codes (Part A.3)
    modules/
      auth/      routes.ts service.ts schemas.ts
      patients/  routes.ts service.ts schemas.ts summary.ts timeline.ts
      grants/    routes.ts service.ts schemas.ts
      visits/    routes.ts service.ts schemas.ts
      documents/ routes.ts service.ts storage.ts ai.worker.ts
      maternal/  routes.ts service.ts schemas.ts rules/{rules.json, edd.ts, schedule.ts, triage.ts}
      reminders/ routes.ts service.ts worker.ts sms/{adapter.ts, mock.ts, sparrow.ts} templates.ts
      sync/      routes.ts service.ts schemas.ts
      facilities/ routes.ts
      codelists/ routes.ts
      meta/      routes.ts   // /rules, /config, /demo/sms(.html)
      audit/     service.ts
    workers.ts            // starts BullMQ workers (same process in hackathon)
  test/
    rules.test.ts         // 16 cases from Part A.6
    sync.test.ts
    grants.test.ts
  public/demo-sms.html

5. Environment and infrastructure
Variable	Example	Notes
PORT	3000	
DATABASE_URL	postgresql://swc:swc@localhost:5432/swc	
REDIS_URL	redis://localhost:6379	BullMQ queues
JWT_SECRET	(random 32+ chars)	Access tokens, HS256
GRANT_SECRET	(different random)	QR grant tokens
ACCESS_TOKEN_TTL	12h	
REFRESH_TOKEN_TTL	30d	
GRANT_TTL_MIN_DEFAULT	10	
GRANT_ACCESS_WINDOW_H	24	
S3_ENDPOINT	http://localhost:9000	MinIO
S3_BUCKET	swc-docs	
S3_ACCESS_KEY / S3_SECRET_KEY	minio / minio123	
SMS_MODE	mock | sparrow	mock writes to mock_sms and /demo/sms
SPARROW_TOKEN / SPARROW_FROM		Only when SMS_MODE=sparrow
OTP_MODE	demo | real	demo → OTP always 123456
AI_MODE	off | on	on requires ANTHROPIC_API_KEY (or another vision LLM)
TZ_DISPLAY	Asia/Kathmandu	Reminder scheduling at 09:00 local
CORS_ORIGINS	*	Hackathon only
LOG_LEVEL	info	

# docker-compose.yml
services:
  postgres: { image: postgres:16, environment: { POSTGRES_USER: swc, POSTGRES_PASSWORD: swc, POSTGRES_DB: swc }, ports: ["5432:5432"], volumes: ["pg:/var/lib/postgresql/data"] }
  redis:    { image: redis:7, ports: ["6379:6379"] }
  minio:    { image: minio/minio, command: server /data --console-address ":9001", environment: { MINIO_ROOT_USER: minio, MINIO_ROOT_PASSWORD: minio123 }, ports: ["9000:9000","9001:9001"], volumes: ["minio:/data"] }
volumes: { pg: {}, minio: {} }
# After up: create bucket swc-docs (mc or the console). Presigned URLs must use the PUBLIC host (tunnel) — set S3_PUBLIC_ENDPOINT for URL generation if phones cannot reach localhost:9000.

Presigned URL gotcha: the phone must be able to reach the storage host. Either tunnel MinIO too (second cloudflared tunnel) or proxy uploads through the API (POST /documents/:id/upload multipart) as a fallback. Decide in the first hour; the contract allows uploadUrl to point at the API itself.
6. Database schema (Prisma)
// prisma/schema.prisma  (PostgreSQL). Column names are snake_case via @map; JSON keys stay camelCase in the API layer.
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
 
enum Role { patient provider fchv admin }
enum Sex { female male other }
enum GrantScope { read append }
enum DocType { prescription lab discharge referral other }
enum DocStatus { pending_upload uploaded }
enum AiStatus { none queued done failed }
enum PregStatus { active delivered ended }
enum RiskLevel { normal high }
enum Triage { green amber red }
enum DeliveryPlace { home birthing_centre hospital on_the_way }
enum DeliveryMode { normal assisted cs }
enum Outcome { live_birth stillbirth }
enum ReminderKind { anc_due anc_missed follow_up medicine }
enum Channel { sms push }
enum ReminderStatus { pending sent failed cancelled }
enum AuditAction { grant_created grant_redeemed record_viewed visit_added contact_recorded document_added grant_revoked }
enum FacilityType { health_post phcc hospital birthing_centre }
 
model User {
  id          String   @id @default(uuid())
  phone       String   @unique
  pinHash     String?  @map("pin_hash")
  role        Role     @default(patient)
  name        String
  facilityId  String?  @map("facility_id")
  facility    Facility? @relation(fields: [facilityId], references: [id])
  createdAt   DateTime @default(now()) @map("created_at")
  patients    Patient[]
  refreshTokens RefreshToken[]
  @@map("users")
}
model RefreshToken { id String @id @default(uuid()); userId String @map("user_id"); user User @relation(fields:[userId], references:[id]); tokenHash String @unique @map("token_hash"); expiresAt DateTime @map("expires_at"); revokedAt DateTime? @map("revoked_at"); @@map("refresh_tokens") }
model OtpCode { phone String @id; code String; expiresAt DateTime @map("expires_at"); attempts Int @default(0); @@map("otp_codes") }
model InviteCode { code String @id; role Role; facilityId String @map("facility_id"); usedByUserId String? @map("used_by_user_id"); @@map("invite_codes") }
 
model Patient {
  id            String   @id                       // client-generated uuid
  ownerUserId   String   @map("owner_user_id")
  owner         User     @relation(fields: [ownerUserId], references: [id])
  name          String
  sex           Sex
  dob           DateTime @db.Date
  bloodGroup    String?  @map("blood_group")
  ward          Int?
  municipality  String?
  allergies     Json     @default("[]")
  chronicConditions Json @default("[]") @map("chronic_conditions")
  emergencyContactPhone String? @map("emergency_contact_phone")
  version       Int      @default(1)
  updatedAt     DateTime @updatedAt @map("updated_at")
  deleted       Boolean  @default(false)
  visits        Visit[]
  documents     Document[]
  pregnancies   Pregnancy[]
  grants        AccessGrant[]
  audits        AuditEntry[]
  reminders     Reminder[]
  @@index([ownerUserId]) @@index([updatedAt])
  @@map("patients")
}
model AccessGrant {
  id               String     @id @default(uuid())
  patientId        String     @map("patient_id")
  patient          Patient    @relation(fields: [patientId], references: [id])
  scope            GrantScope
  tokenJti         String     @unique @map("token_jti")
  expiresAt        DateTime   @map("expires_at")
  redeemedByUserId String?    @map("redeemed_by_user_id")
  redeemedAt       DateTime?  @map("redeemed_at")
  accessUntil      DateTime?  @map("access_until")
  revokedAt        DateTime?  @map("revoked_at")
  createdAt        DateTime   @default(now()) @map("created_at")
  @@index([patientId, redeemedByUserId, accessUntil])
  @@map("access_grants")
}
model Visit {
  id              String   @id
  patientId       String   @map("patient_id")
  patient         Patient  @relation(fields: [patientId], references: [id])
  providerUserId  String   @map("provider_user_id")
  providerName    String   @map("provider_name")
  facilityId      String?  @map("facility_id")
  facilityName    String?  @map("facility_name")
  visitAt         DateTime @map("visit_at")
  chiefComplaintCode String @map("chief_complaint_code")
  vitals          Json     @default("{}")
  diagnosisCodes  Json     @default("[]") @map("diagnosis_codes")
  notes           String?
  advice          String?
  followUpAt      DateTime? @db.Date @map("follow_up_at")
  referral        Json?
  prescriptions   Json     @default("[]")   // Prescription[] embedded
  supersedesId    String?  @map("supersedes_id")
  version         Int      @default(1)
  updatedAt       DateTime @updatedAt @map("updated_at")
  deleted         Boolean  @default(false)
  @@index([patientId, visitAt]) @@index([updatedAt])
  @@map("visits")
}
model Document {
  id               String    @id
  patientId        String    @map("patient_id")
  patient          Patient   @relation(fields: [patientId], references: [id])
  uploadedByUserId String    @map("uploaded_by_user_id")
  type             DocType
  title            String
  takenAt          DateTime  @db.Date @map("taken_at")
  status           DocStatus @default(pending_upload)
  objectKey        String    @map("object_key")
  contentType      String    @map("content_type")
  aiSummary        String?   @map("ai_summary")
  aiSummaryStatus  AiStatus  @default(none) @map("ai_summary_status")
  version          Int       @default(1)
  updatedAt        DateTime  @updatedAt @map("updated_at")
  deleted          Boolean   @default(false)
  @@index([patientId]) @@index([updatedAt])
  @@map("documents")
}
model Pregnancy {
  id                 String     @id
  patientId          String     @map("patient_id")
  patient            Patient    @relation(fields: [patientId], references: [id])
  lmp                DateTime?  @db.Date
  edd                DateTime   @db.Date
  gravida            Int
  para               Int
  riskFactors        Json       @default("[]") @map("risk_factors")
  riskLevel          RiskLevel  @default(normal) @map("risk_level")
  status             PregStatus @default(active)
  birthPlan          Json?      @map("birth_plan")
  registeredByUserId String     @map("registered_by_user_id")
  version            Int        @default(1)
  updatedAt          DateTime   @updatedAt @map("updated_at")
  deleted            Boolean    @default(false)
  contacts           AncContact[]
  delivery           Delivery?
  reminders          Reminder[]
  @@index([patientId, status]) @@index([updatedAt])
  @@map("pregnancies")
}
model AncContact {
  id             String    @id           // uuid v5(pregnancyId + ":" + contactNo)
  pregnancyId    String    @map("pregnancy_id")
  pregnancy      Pregnancy @relation(fields: [pregnancyId], references: [id])
  contactNo      Int       @map("contact_no")
  weekTarget     Int       @map("week_target")
  dueAt          DateTime  @db.Date @map("due_at")
  doneAt         DateTime? @map("done_at")
  providerUserId String?   @map("provider_user_id")
  findings       Json?
  dangerSigns    Json      @default("[]") @map("danger_signs")
  triageLevel    Triage?   @map("triage_level")
  triageReasons  Json      @default("[]") @map("triage_reasons")
  referral       Json?
  version        Int       @default(1)
  updatedAt      DateTime  @updatedAt @map("updated_at")
  deleted        Boolean   @default(false)
  @@unique([pregnancyId, contactNo]) @@index([updatedAt])
  @@map("anc_contacts")
}
model Delivery {
  id            String        @id
  pregnancyId   String        @unique @map("pregnancy_id")
  pregnancy     Pregnancy     @relation(fields: [pregnancyId], references: [id])
  deliveredAt   DateTime      @map("delivered_at")
  place         DeliveryPlace
  mode          DeliveryMode
  outcome       Outcome
  babyWeightKg  Float?        @map("baby_weight_kg")
  babySex       Sex?          @map("baby_sex")
  complications Json          @default("[]")
  version       Int           @default(1)
  updatedAt     DateTime      @updatedAt @map("updated_at")
  deleted       Boolean       @default(false)
  @@map("deliveries")
}
model Reminder {
  id             String         @id @default(uuid())
  patientId      String         @map("patient_id")
  patient        Patient        @relation(fields: [patientId], references: [id])
  pregnancyId    String?        @map("pregnancy_id")
  pregnancy      Pregnancy?     @relation(fields: [pregnancyId], references: [id])
  refId          String?        @map("ref_id")      // ancContact id or visit id
  kind           ReminderKind
  dueAt          DateTime       @map("due_at")
  channel        Channel        @default(sms)
  recipientPhone String         @map("recipient_phone")
  recipientRole  String         @map("recipient_role")
  messageNp      String         @map("message_np")
  messageEn      String         @map("message_en")
  status         ReminderStatus @default(pending)
  sentAt         DateTime?      @map("sent_at")
  @@index([status, dueAt])
  @@map("reminders")
}
model Facility {
  id                String       @id
  name              String
  type              FacilityType
  hasBirthingCentre Boolean      @map("has_birthing_centre")
  phone             String?
  lat               Float
  lng               Float
  municipality      String
  users             User[]
  @@map("facilities")
}
model AuditEntry {
  id                String      @id @default(uuid())
  patientId         String      @map("patient_id")
  patient           Patient     @relation(fields: [patientId], references: [id])
  actorUserId       String      @map("actor_user_id")
  actorName         String      @map("actor_name")
  actorFacilityName String?     @map("actor_facility_name")
  action            AuditAction
  grantId           String?     @map("grant_id")
  at                DateTime    @default(now())
  @@index([patientId, at])
  @@map("audit_entries")
}
model CodeListItem { kind String; code String; labelEn String @map("label_en"); labelNp String @map("label_np"); meta Json?; @@id([kind, code]); @@map("codelist_items") }
model SyncOp { opId String @id @map("op_id"); deviceId String @map("device_id"); userId String @map("user_id"); status String; resultJson Json @map("result_json"); createdAt DateTime @default(now()) @map("created_at"); @@map("sync_ops") }
model MockSms { id String @id @default(uuid()); to String; text String; sentAt DateTime @default(now()) @map("sent_at"); @@map("mock_sms") }

7. Authentication and authorisation
7.1 Flow
1.	POST /auth/otp/request → upsert otp_codes(phone, code, expires 5 min). OTP_MODE=demo → code "123456", returned as demoOtp. Rate-limit 5/10 min per phone.
2.	POST /auth/otp/verify → check code & attempts (max 5) → issue tempToken (JWT typ "temp", 10 min) → hasPin = user exists && pinHash != null.
3.	POST /auth/pin/set (Bearer tempToken) → create user if missing (role patient, name) → pinHash = argon2id → issue access (12 h) + refresh (opaque 32 bytes, store argon2 hash, 30 d).
4.	POST /auth/pin/login → argon2 verify → tokens. 5 failures → lock 15 min (Redis key).
5.	POST /auth/refresh → rotate: revoke old, issue new pair.
6.	POST /auth/provider/activate → invite code lookup (unused or reusable for demo) → set role + facilityId.
7.2 Tokens
accessToken claims: { sub: userId, role, fid: facilityId|null, typ: "access", iat, exp }   // HS256 JWT_SECRET
grant token claims: { typ: "grant", gid: grantId, pid: patientId, scope, iat, exp }          // HS256 GRANT_SECRET
QR payload = "SWC1:" + grantToken

7.3 Authorisation helpers
requireAuth()                 → 401 UNAUTHENTICATED if missing/invalid/expired
requireRole('provider','fchv') → 403 FORBIDDEN
canReadPatient(user, patientId):  owner OR exists access_grants where patient_id = :pid AND redeemed_by_user_id = :uid AND revoked_at IS NULL AND access_until > now()
canAppendPatient(user, patientId): owner OR (same as above AND scope = 'append')
// fchv: may append visits? NO (only anc_contacts, pregnancies, documents). Enforce in visits.service: role fchv → 403.
// Every canRead on provider path also writes AuditEntry record_viewed at most once per 10 min per (actor, patient).

8. Serializers (the single place that produces API JSON)
Prisma returns Date objects and snake_case-mapped fields; the API returns camelCase with ISO strings. One function per entity, used by every route and by sync pull, so shapes never drift.
export const toPatientDto = (r: Patient) => ({
  id: r.id, ownerUserId: r.ownerUserId, name: r.name, sex: r.sex, dob: dateOnly(r.dob), bloodGroup: r.bloodGroup,
  ward: r.ward, municipality: r.municipality, allergies: r.allergies as string[], chronicConditions: r.chronicConditions as string[],
  emergencyContactPhone: r.emergencyContactPhone, version: r.version, updatedAt: r.updatedAt.toISOString(), deleted: r.deleted });
export const toVisitDto, toDocumentDto (adds downloadUrl via presign when uploaded), toPregnancyDto (adds gestationalAgeDays, nextContact),
       toAncContactDto, toDeliveryDto, toReminderDto, toFacilityDto (optional distanceKm), toAuditDto, toGrantDto (never includes token), toUserDto.
dateOnly(d: Date) => d.toISOString().slice(0,10)   // dates are stored as DATE (UTC midnight)

9. Module specifications
9.1 Patients
•	POST /patients: zod schema requires client id (uuid). If exists and ownerUserId = me → 200 existing. If exists and other owner → 409 with code NOT_FOUND semantics? No: return 403 FORBIDDEN. Else create version 1.
•	PATCH /patients/:id: owner only; require body.version === current → else 409 VERSION_CONFLICT with details.current; apply; version++.
•	GET /patients: role patient → owned; role provider/fchv → owned ∪ patients with active redeemed grants (accessUntil > now).
•	GET /patients/:id: canReadPatient; build summary (9.1.1).
•	GET /patients/:id/timeline: canReadPatient; union query (9.1.2).
•	GET /patients/:id/audit: owner only.
9.1.1 Summary builder
activeProblems  = distinct diagnosisCodes across visits (not deleted) + patient.chronicConditions, joined to codelist labels; since = earliest visitAt with that code (or null)
currentMedicines = prescriptions from visits where visitAt + durationDays >= today, newest first (dedupe by drugCode keep latest)
allergies       = patient.allergies
lastVitals      = vitals of the latest visit that has any vitals + at = visitAt
activePregnancy = pregnancy with status active (toPregnancyDto) or null
lastVisitAt, visitCount

9.1.2 Timeline builder
SELECT rows from visits, documents, pregnancies (registered), anc_contacts (doneAt not null), deliveries for patient
map each to TimelineItem { kind, at, title, subtitle, badge, refId, payload }
  visit:      at=visitAt, title="Visit — {facilityName} — {first diagnosis label}", subtitle="{complaint label} · BP {sys}/{dia}", badge=null
  document:   at=takenAt, title="{type label}: {title}", badge=null
  pregnancy_registered: at=updatedAt of create, title="Pregnancy registered", subtitle="EDD {edd}"
  anc_contact: at=doneAt, title="ANC contact {n} (week {weekTarget})", subtitle="BP {sys}/{dia} · Hb {hb}" + (referral ? " · referred" : ""), badge=triageLevel
  delivery:   at=deliveredAt, title="Delivery — {place}", subtitle="{outcome}, {babyWeightKg} kg", badge=null
ORDER BY at DESC, cursor pagination on at (before), limit 50

9.2 Grants
POST /grants        owner only; rate limit 20/h/patient; create row (jti = uuid) → sign token → { grant, token, qrPayload }; audit grant_created
POST /grants/redeem role provider|fchv; parse "SWC1:" prefix → verify JWT (GRANT_SECRET) → load grant by jti
                    expired (exp < now or expiresAt < now) → 403 GRANT_EXPIRED; revoked → 403 GRANT_EXPIRED
                    redeemedByUserId set and != me → 409 ALREADY_REDEEMED; == me → idempotent (return bundle again)
                    set redeemedByUserId, redeemedAt, accessUntil = now + 24 h; audit grant_redeemed
                    return { grant, patient, summary, timeline(50), pregnancy(active), ancContacts }
POST /grants/:id/revoke owner only; set revokedAt; audit grant_revoked

9.3 Visits
•	POST /patients/:id/visits: canAppendPatient AND role != fchv. Idempotent on id. Fill providerUserId/providerName/facility from request.user (patient owner adding their own visit: providerName = "Self-reported"). Validate codes exist in codelist (complaint, diagnosis, drug) → else 400 with details. Create; if followUpAt → create Reminder follow_up (dueAt = followUpAt − 1 day 09:00 Kathmandu, recipient patient owner phone). Audit visit_added.
•	GET /patients/:id/visits: canReadPatient; newest first.
9.4 Documents
POST /documents/presign   canAppendPatient; sizeBytes <= 2 MB; contentType in [image/jpeg, image/png]
                          objectKey = patients/{patientId}/{documentId}.jpg ; create row status pending_upload
                          uploadUrl = presigned PUT (15 min) on S3_PUBLIC_ENDPOINT
POST /documents/:id/complete  HEAD object exists → status uploaded; audit document_added; return dto with downloadUrl (presigned GET 1 h)
GET  /documents/:id       canReadPatient
POST /documents/:id/summarize AI_MODE=off → 501 { code: "NOT_IMPLEMENTED" } ; else set aiSummaryStatus queued, enqueue ai-summary job
ai.worker: download object → LLM vision call → aiSummary (Nepali + English, medicines list, "AI draft — verify" footer) → status done/failed

9.5 Maternal
POST /patients/:id/pregnancies  canAppendPatient (owner, provider, fchv). patient.sex must be female → 422 RULE_VIOLATION. No other active pregnancy → else 422.
   edd = body.edd ?? lmp + 280 d ; riskLevel = riskFactors.length ? high : normal
   transaction: create pregnancy; create 8 anc_contacts with id = ancContactId(pregnancyId, n), dueAt = (edd − 280 d) + week×7 d
                create reminders anc_due for each contact whose dueAt > today (dueAt − 1 day @ 09:00 Kathmandu) for patient phone + emergencyContactPhone
                create reminders anc_missed for each contact (dueAt + 3 d @ 09:00) status pending
GET  /pregnancies/:id           canReadPatient(pregnancy.patientId)
PATCH /pregnancies/:id          version check; allowed fields birthPlan, riskFactors (recompute riskLevel), status = ended
PUT  /pregnancies/:id/contacts/:contactNo  canAppendPatient; contactNo 1..8; contact must exist
   gaDays = gestationalAgeDays(edd, doneAt) ; triage = triage(findings, dangerSigns, pregnancy, gaDays) (rules/triage.ts)
   update contact (doneAt, providerUserId, findings, dangerSigns, triageLevel, triageReasons, referral) version++
   cancel pending anc_missed reminders with refId = contact.id
   nearestReferral = facility with hasBirthingCentre nearest to request.user.facility (or null)
   audit contact_recorded ; return { ancContact, nearestReferral }
POST /pregnancies/:id/delivery  pregnancy.status must be active → else 422; create delivery; pregnancy.status = delivered; cancel all pending reminders for the pregnancy

Rules service: rules/rules.json is the RULES object from Part A.5 (served verbatim by GET /rules). edd.ts, schedule.ts, triage.ts mirror the Dart functions; the triage algorithm is written out in the frontend document Section 12 and must be ported line-for-line. test/rules.test.ts encodes the 16 cases from Part A.6.
9.6 Reminders and SMS
worker (BullMQ repeat every 60 s):
  SELECT reminders WHERE status = pending AND dueAt <= now() LIMIT 100
  for each: sms.send(recipientPhone, messageNp) → status sent + sentAt, or failed (retry next tick up to 3 times, then failed)
templates.ts: buildAncDue(patient, contact, facility) → { messageNp, messageEn } using BS date via nepali-date-converter (npm) or bikram-sambat
SmsAdapter { send(to, text): Promise<void> }
  MockSms  → insert mock_sms; GET /demo/sms returns last 50; /demo/sms.html renders them (auto-refresh 3 s, large font for projector)
  SparrowSms → POST https://api.sparrowsms.com/v2/sms/ { token, from, to, text }  (verify current API docs)
GET /patients/:id/reminders  canReadPatient; upcoming (pending) + last 20 sent

Demo trick: add POST /demo/reminders/fire (SMS_MODE=mock only) that marks the next pending reminder for a patient as due now, so the projector shows an SMS on cue without waiting for 09:00.
9.7 Sync
POST /sync/push { deviceId, changes[] }   (max 50; else 400)
  for each change (sequentially, each in its own transaction):
    if sync_ops has opId → results.push({ opId, status: "duplicate", row: stored }) ; continue
    authorise by table: patients → owner; visits → canAppend && role != fchv; documents → canAppend (meta only; status cannot be set to uploaded by client);
                        pregnancies/anc_contacts/deliveries → canAppend
    if table in append-only [visits, deliveries]:  exists(rowId) ? applied-idempotent(return existing) : create(version 1)
    else (patients, documents, pregnancies, anc_contacts):
       current = find(rowId)
       if !current: baseVersion must be 0 → create version 1 (pregnancies: run the same creation logic as POST incl. contacts/reminders; anc_contacts: only allowed if pregnancy exists, upsert by deterministic id)
       else if baseVersion != current.version → { status: "conflict", current: dto(current) }
       else apply payload (whitelisted fields per table), version++ ; anc_contacts: recompute triage server-side, cancel reminders like PUT
    store sync_ops(opId, status, resultJson)
    zod failure → { status: "rejected", error: { code: "VALIDATION_ERROR", message } } ; authz failure → rejected FORBIDDEN
  return { results, serverTime }
GET /sync/pull?since&deviceId
  patientIds = owned ∪ active-grant patients
  rows from patients, visits, documents, pregnancies, anc_contacts (by pregnancy.patientId), deliveries WHERE updatedAt > since AND patientId in (…)
  ORDER BY updatedAt ASC LIMIT 200 ; cursor = last updatedAt ; hasMore = count == 200
  documents: include downloadUrl when uploaded

•	updatedAt must be set by the server on every write (Prisma @updatedAt does this) — the cursor relies on it. Use a transaction-time timestamp so rows in one batch share ordering.
•	Because "since" uses strict >, two rows with identical updatedAt could be skipped at a page boundary; mitigate by ordering (updatedAt, id) and using a composite cursor if time allows (Tier 2).
9.8 Facilities, code lists, meta
•	GET /facilities/nearby: Haversine in SQL or in memory (≤ 200 rows); filter birthing=true → hasBirthingCentre; sort by distanceKm; limit.
•	GET /codelists: all rows grouped; version constant from seed (CODELIST_VERSION). Cache-Control: max-age=3600.
•	GET /rules: rules.json verbatim. GET /config: flags from env.
•	GET /demo/sms, /demo/sms.html: only when SMS_MODE=mock; otherwise 404.
10. Seed data (prisma/seed.ts) — the demo depends on this
Set	Content
Facilities	f_0001 Ghorahi Health Post (health_post, no birthing centre) · f_0002 Rapti Provincial Hospital (hospital, birthing) · f_0003 Tulsipur PHCC (phcc, birthing) · f_0004 Ward 5 Birthing Centre — with real-looking coordinates in Dang district.
Invite codes	HA-GHORAHI-01 → provider @ f_0001 · FCHV-W5-01 → fchv @ f_0001 · ADMIN-01 → admin
Users	Sita's husband/phone owner +9779801000001 (patient, PIN 1234) · Ramesh Thapa (HA) +9779801000002 (provider, PIN 1234) · Kamala FCHV +9779801000003 (fchv, PIN 1234)
Patients	Sita Chaudhary (female, 24, B+, ward 5) · Ram Bahadur Chaudhary (male, 58, chronic E11, allergy penicillin) · Aarav (male, 3) — all owned by user 1
Visits	Ram: 4 visits over 12 months (E11, I10), last one with Metformin + Amlodipine prescriptions; Sita: 1 visit (fever) last year
Pregnancy	Sita: lmp = today − 210 days (so week 30 on demo day), gravida 1, contacts 1–3 done green, contact 4 due today (not done), reminders generated; anc_due reminder for contact 4 already sent (mock_sms row so the projector shows it)
Documents	Ram: one discharge sheet (use a placeholder image uploaded to MinIO by the seed)
Code lists	complaint (40): CC_FEVER, CC_COUGH, CC_DIARRHOEA, CC_ABD_PAIN, CC_HEADACHE, CC_POLYURIA, CC_ANC, … · diagnosis (60, ICD-10 style): A09 diarrhoea, J06 URTI, E11 T2 diabetes, I10 hypertension, O14 pre-eclampsia, D50 iron-deficiency anaemia, … · drug (50 from the free essential list): PARACETAMOL_500, AMOXICILLIN_500, METFORMIN_500, AMLODIPINE_5, ORS, ZINC_20, IFA, CALCIUM_500, ALBENDAZOLE_400, TD_VACCINE, … · dangerSign and riskFactor mirrored from RULES for picklist use
Reset	npm run demo:reset truncates all tables and re-seeds; also recomputes Sita's lmp relative to today so she is always at week 30

11. Error handling, validation, security
•	Global error handler maps AppError → { ok:false, error:{code,message,details} } with the HTTP status from Part A.3; zod errors → 400 VALIDATION_ERROR with details = { field: message }; unknown → 500 INTERNAL (log stack, never leak).
•	Rate limits: /auth/otp/request 5/10 min/phone; /auth/pin/login 10/15 min/IP+phone; /grants 20/h/patient; global 300/min/IP.
•	CORS open for the hackathon; helmet-style headers via @fastify/helmet.
•	Never log PINs, OTPs, tokens, or message bodies at info level.
•	Grant tokens are single-purpose (typ "grant") and cannot be used as Bearer access tokens; access tokens cannot redeem grants.
•	Documents: object keys are unguessable (uuid); download URLs expire in 1 h.
•	Soft deletes only; audit rows are immutable.
12. Testing
7.	test/rules.test.ts — the 16 shared cases (Part A.6). Must pass before wiring endpoints.
8.	test/sync.test.ts — create visit via push twice (idempotent), conflict on anc_contact, pull ordering and cursor.
9.	test/grants.test.ts — create → redeem → expired → already redeemed → revoked; access window 24 h.
10.	Smoke: a script (scripts/smoke.sh with curl or a vitest file) that walks the demo path: login as owner → create patient → create grant → login as HA → redeem → add visit → register pregnancy → record contact 4 red → check /patients/:id/timeline and /demo/sms.
13. 32-hour plan (backend)
Hours	Deliverable
0–2	Repo, compose up, Prisma schema + migration, config, envelope + error handler, pino, health route.
2–4	Seed script v1 (facilities, codes, users, invite codes); /codelists, /rules, /config.
4–7	Auth module complete (OTP demo, PIN, refresh, provider activate); auth plugin; rate limits.
7–10	Patients CRUD + summary + timeline; serializers; audit service.
10–12	Grants (create/redeem/revoke) with bundle response.
12–14	Visits + follow_up reminders.
14–18	Sync push/pull with sync_ops idempotency and conflicts; tests.
18–22	Maternal: rules.ts + 16 tests, pregnancies, contacts (triage), delivery; reminder generation.
22–24	Reminders worker, mock SMS + /demo/sms.html, demo fire endpoint.
24–26	Documents presign/complete with MinIO (decide tunnel vs proxy); seed image.
26–28	Integration with the real app; fix mismatches together; expose via cloudflared; demo:reset.
28–32	Smoke script, Sparrow adapter if approved, AI worker if time, freeze.

14. Instructions for an AI coding agent
You are implementing the Node.js backend for "Swasthya Card" for a 32-hour hackathon.
Read the whole document first, especially Part A (API contract), Section 6 (Prisma schema) and Section 9 (sync).
Rules for you:
1. Never change a JSON field name, enum value, endpoint path, or the response envelope from Part A. The mobile app is built against it in parallel.
2. Stack is fixed: Node 20, TypeScript, Fastify 4, Prisma 5, PostgreSQL 16, Redis 7 + BullMQ, MinIO (S3 API), zod, jose (JWT), argon2, pino, vitest. Docker Compose for infra.
3. Build in this order: compose + Prisma schema + migrate + seed → envelope + error handler + zod → auth → codelists/rules/config → patients → grants → visits → sync push/pull → maternal (rules service + tests from A.6) → reminders worker + mock SMS page → documents (presign) → audit → facilities → optional AI worker.
4. Every handler: validate with zod → authorise (role + grant) → transaction → map to API shape (camelCase, ISO strings, dates as YYYY-MM-DD) → envelope.
5. Client-generated ids are trusted as-is; creates are idempotent (same id → return existing, 200).
6. Write the shared rules exactly as in Part A.5; implement the 16 test cases in A.6 with vitest before wiring endpoints.
7. Provide "npm run dev", "npm run seed", "npm test", "npm run demo:reset" (re-seeds demo data).
8. Log every request with pino (method, path, status, ms, userId).
9. Never return raw Prisma objects; always go through a serializer per entity so Dates become strings and Json columns are typed.
10. Serve GET /demo/sms.html (auto-refresh every 3 s) for the projector when SMS_MODE=mock.

 
Part A — Shared API contract (identical in both documents)
This chapter is generated from one source file and pasted into both the frontend and backend documents. If either developer changes anything here, they must tell the other and both documents must be regenerated. Treat it as the law of the project.
A.1 Conventions
•	Base URL: https://<host>/api/v1. During the hackathon the backend runs on a laptop and is exposed with cloudflared/ngrok; the app reads the URL from a settings screen (no rebuild needed).
•	Transport: JSON over HTTPS. Content-Type: application/json; charset=utf-8 on every request with a body.
•	Auth: Authorization: Bearer <accessToken> (JWT, 12 h). Refresh with POST /auth/refresh. Endpoints marked "none" need no header.
•	Response envelope — success: { "ok": true, "data": { … } }. Always an object under data, never a bare array.
•	Response envelope — error: { "ok": false, "error": { "code": "VERSION_CONFLICT", "message": "…", "details": { … } } }. HTTP status matches the table in A.3.
•	Ids: strings. Entities the app can create offline (Patient, Visit, Document, Pregnancy, AncContact, Delivery) use CLIENT-generated UUID v4. The server never re-assigns an id; creating the same id twice is idempotent and returns the existing row.
•	Timestamps: ISO 8601 in UTC with milliseconds, e.g. 2026-09-18T04:05:00.000Z. Calendar dates (dob, lmp, edd, dueAt, followUpAt, takenAt) are YYYY-MM-DD in AD. The server never stores or returns Bikram Sambat; the app converts for display using nepali_utils.
•	Phones: E.164 (+977…). The app normalises user input (strip spaces, add +977 if 10 digits starting with 9).
•	Naming: JSON keys are camelCase everywhere (the backend maps to snake_case columns internally).
•	Optional vs null: a nullable field is always present in responses (as null). In requests, omitted = unchanged (PATCH) or default (POST).
•	Versioning: every syncable entity carries integer version and updatedAt assigned by the server. Clients send baseVersion on sync and version on PATCH.
•	Language: the server returns both labelEn and labelNp (or messageEn/messageNp); the app picks by locale. No Accept-Language negotiation.
•	Pagination: cursor style (before / since / cursor), never page numbers.
A.2 Entities (the exact JSON shapes)
Field types are JSON types. "Syncable" entities are stored in the device database and pushed/pulled by the sync engine; all others are read from the server on demand.
User
An account bound to a phone number. Role decides which screens and endpoints are allowed.
Field	Type	Notes
id	string (uuid)	Server-generated.
phone	string	E.164 without spaces, e.g. "+9779812345678". Unique.
role	enum	"patient" | "provider" | "fchv" | "admin"
name	string	Display name.
facilityId	string | null	Only for provider/fchv/admin.
facilityName	string | null	Denormalised for display.
createdAt	string (ISO 8601 UTC)	

Example JSON
{
  "id": "u_22222222-2222-4222-8222-222222222222",
  "phone": "+9779801000002",
  "role": "provider",
  "name": "Ramesh Thapa (HA)",
  "facilityId": "f_0001",
  "facilityName": "Ghorahi Health Post",
  "createdAt": "2026-09-18T03:10:00.000Z"
}

Patient
A person whose record is kept. One User can own several Patients (family profiles). Syncable.
Field	Type	Notes
id	string (uuid)	CLIENT-generated (UUID v4) so it can be created offline.
ownerUserId	string	The User who created it.
name	string	
sex	enum	"female" | "male" | "other"
dob	string (YYYY-MM-DD, AD)	Server stores AD only; the app converts to BS for display.
bloodGroup	string | null	"A+", "O-", … or null
ward	integer | null	
municipality	string | null	
allergies	string[]	Free text items, e.g. ["penicillin"]
chronicConditions	string[]	Codes from codelist kind=diagnosis, e.g. ["E11"] (diabetes).
emergencyContactPhone	string | null	E.164.
version	integer	Starts at 1; server increments on every accepted update.
updatedAt	string (ISO)	Server time of last accepted write.
deleted	boolean	Soft delete.

Example JSON
{
  "id": "p_a1a1a1a1-0000-4000-8000-000000000001",
  "ownerUserId": "u_11111111-1111-4111-8111-111111111111",
  "name": "Sita Chaudhary",
  "sex": "female",
  "dob": "2002-04-11",
  "bloodGroup": "B+",
  "ward": 5,
  "municipality": "Ghorahi",
  "allergies": [],
  "chronicConditions": [],
  "emergencyContactPhone": "+9779801000009",
  "version": 3,
  "updatedAt": "2026-09-18T04:00:00.000Z",
  "deleted": false
}

AccessGrant
Permission for a provider to read (and optionally append to) one Patient. Created by the patient, encoded into the QR, redeemed by the provider.
Field	Type	Notes
id	string	Server-generated.
patientId	string	
scope	enum	"read" | "append" (append implies read).
token	string (JWT)	Returned ONLY on creation. This string is the QR payload.
expiresAt	string (ISO)	Default 10 minutes after creation.
redeemedByUserId	string | null	Set on redeem.
redeemedAt	string | null	
revokedAt	string | null	
accessUntil	string (ISO)	After redeem, the provider may use the patient record until this time (24 h).

Example JSON
{
  "id": "g_d4d4d4d4-0000-4000-8000-000000000001",
  "patientId": "p_a1a1a1a1-0000-4000-8000-000000000001",
  "scope": "append",
  "expiresAt": "2026-09-18T04:10:00.000Z",
  "redeemedByUserId": null,
  "redeemedAt": null,
  "revokedAt": null,
  "accessUntil": null
}

Visit
One clinical encounter. Append-only: never edited after sync; a correction is a new Visit with supersedesId. Syncable.
Field	Type	Notes
id	string (uuid)	CLIENT-generated.
patientId	string	
providerUserId	string	The provider who recorded it (server fills from token if missing).
providerName	string	Denormalised for the timeline.
facilityId	string | null	
facilityName	string | null	
visitAt	string (ISO)	When the encounter happened (client clock).
chiefComplaintCode	string	From codelist kind=complaint, e.g. "CC_FEVER".
vitals	object	{ bpSys?: int, bpDia?: int, pulse?: int, tempC?: number, weightKg?: number, spo2?: int } — all optional.
diagnosisCodes	string[]	From codelist kind=diagnosis (ICD-10 style, e.g. "E11").
notes	string | null	Free text, ≤ 1000 chars.
advice	string | null	
followUpAt	string (YYYY-MM-DD) | null	
referral	object | null	{ facilityId?: string, facilityName: string, reason: string, urgency: "routine" | "urgent" }
prescriptions	Prescription[]	Embedded on create and read (see Prescription).
supersedesId	string | null	Id of the Visit this one corrects.
version	integer	
updatedAt	string (ISO)	
deleted	boolean	

Example JSON
{
  "id": "v_c3c3c3c3-0000-4000-8000-000000000001",
  "patientId": "p_a1a1a1a1-0000-4000-8000-000000000002",
  "providerUserId": "u_22222222-2222-4222-8222-222222222222",
  "providerName": "Ramesh Thapa (HA)",
  "facilityId": "f_0001",
  "facilityName": "Ghorahi Health Post",
  "visitAt": "2026-09-18T04:05:00.000Z",
  "chiefComplaintCode": "CC_POLYURIA",
  "vitals": {
    "bpSys": 138,
    "bpDia": 88,
    "pulse": 76,
    "weightKg": 71.5
  },
  "diagnosisCodes": [
    "E11"
  ],
  "notes": "Fasting sugar 168 mg/dl on glucometer.",
  "advice": "Diet, walk 30 min daily",
  "followUpAt": "2026-10-18",
  "referral": null,
  "prescriptions": [
    {
      "id": "rx_0001",
      "drugCode": "METFORMIN_500",
      "drugName": "Metformin 500 mg",
      "dose": "1 tab",
      "frequency": "BD",
      "durationDays": 30,
      "instructionsNp": "खाना पछि"
    }
  ],
  "supersedesId": null,
  "version": 1,
  "updatedAt": "2026-09-18T04:06:00.000Z",
  "deleted": false
}

Prescription
A medicine line inside a Visit. Never sent alone.
Field	Type	Notes
id	string	CLIENT-generated.
drugCode	string	From codelist kind=drug.
drugName	string	Denormalised label.
dose	string	e.g. "1 tab", "5 ml"
frequency	enum	"OD" | "BD" | "TDS" | "QID" | "SOS" | "HS"
durationDays	integer	
instructionsNp	string | null	Nepali instruction shown to the patient.

Example JSON
{
  "id": "rx_0001",
  "drugCode": "METFORMIN_500",
  "drugName": "Metformin 500 mg",
  "dose": "1 tab",
  "frequency": "BD",
  "durationDays": 30,
  "instructionsNp": "खाना पछि"
}

Document
A photo of a paper record (prescription, lab report, discharge sheet, referral). File bytes go to object storage via presigned URL; metadata is syncable.
Field	Type	Notes
id	string (uuid)	CLIENT-generated.
patientId	string	
uploadedByUserId	string	
type	enum	"prescription" | "lab" | "discharge" | "referral" | "other"
title	string	e.g. "Bharatpur Hospital discharge sheet"
takenAt	string (YYYY-MM-DD)	Date on the paper, entered by user.
status	enum	"pending_upload" | "uploaded"
downloadUrl	string | null	Presigned GET URL, valid 1 h; present on read when status=uploaded.
aiSummary	string | null	Nepali + English summary. Always shown with an "AI draft" label.
aiSummaryStatus	enum	"none" | "queued" | "done" | "failed"
version	integer	
updatedAt	string (ISO)	
deleted	boolean	

Example JSON
{
  "id": "d_e5e5e5e5-0000-4000-8000-000000000001",
  "patientId": "p_a1a1a1a1-0000-4000-8000-000000000002",
  "uploadedByUserId": "u_11111111-1111-4111-8111-111111111111",
  "type": "discharge",
  "title": "Bharatpur Hospital discharge sheet",
  "takenAt": "2026-07-02",
  "status": "uploaded",
  "downloadUrl": "https://storage.example/…",
  "aiSummary": null,
  "aiSummaryStatus": "none",
  "version": 1,
  "updatedAt": "2026-09-18T04:20:00.000Z",
  "deleted": false
}

Pregnancy
One pregnancy episode for a female Patient. Creating it generates AncContacts and Reminders on the server AND on the device (same rules). Syncable.
Field	Type	Notes
id	string (uuid)	CLIENT-generated.
patientId	string	
lmp	string (YYYY-MM-DD) | null	Last menstrual period. Either lmp or edd must be given.
edd	string (YYYY-MM-DD)	Expected delivery date = lmp + 280 days if not given.
gravida	integer	Number of pregnancies including this one.
para	integer	Previous births.
riskFactors	string[]	Codes from RULES.riskFactors, e.g. ["AGE_LT_18", "PREV_CS"].
riskLevel	enum	Computed: "normal" | "high". high if any riskFactor present.
status	enum	"active" | "delivered" | "ended"
birthPlan	object | null	{ facilityId?: string, facilityName?: string, transport?: string, moneySaved?: boolean, bloodDonorName?: string, bloodDonorPhone?: string, companionName?: string }
registeredByUserId	string	
gestationalAgeDays	integer	Computed on read: today − (edd − 280 d). Not stored.
nextContact	AncContact | null	Computed on read: earliest contact with doneAt = null.
version	integer	
updatedAt	string (ISO)	
deleted	boolean	

Example JSON
{
  "id": "pg_b2b2b2b2-0000-4000-8000-000000000001",
  "patientId": "p_a1a1a1a1-0000-4000-8000-000000000001",
  "lmp": "2026-02-20",
  "edd": "2026-11-27",
  "gravida": 1,
  "para": 0,
  "riskFactors": [],
  "riskLevel": "normal",
  "status": "active",
  "birthPlan": {
    "facilityId": "f_0002",
    "facilityName": "Rapti Provincial Hospital",
    "transport": "Neighbour's jeep",
    "moneySaved": true,
    "bloodDonorName": "Hari",
    "bloodDonorPhone": "+9779801000011",
    "companionName": "Mother-in-law"
  },
  "registeredByUserId": "u_22222222-2222-4222-8222-222222222222",
  "gestationalAgeDays": 210,
  "nextContact": null,
  "version": 2,
  "updatedAt": "2026-09-18T04:30:00.000Z",
  "deleted": false
}

AncContact
One scheduled antenatal contact (8 per pregnancy per RULES.ancSchedule). Created empty with dueAt; filled when the contact happens. Syncable.
Field	Type	Notes
id	string (uuid)	CLIENT-generated on the device that creates the Pregnancy; the server creates the same set with deterministic ids = sha1(pregnancyId + contactNo) formatted as uuid — see Sync rules.
pregnancyId	string	
contactNo	integer 1..8	
weekTarget	integer	Gestational week from RULES.ancSchedule.
dueAt	string (YYYY-MM-DD)	edd − 280 d + weekTarget×7.
doneAt	string (ISO) | null	null = not yet done.
providerUserId	string | null	
findings	object | null	{ weightKg?, bpSys?, bpDia?, fundalHeightCm?, fhrBpm?, hbGdl?, urineProtein?: "neg"|"trace"|"+"|"++"|"+++", tdDoseGiven?: bool, ifaGiven?: bool, dewormingGiven?: bool, calciumGiven?: bool, fetalMovement?: "normal"|"reduced"|"absent" }
dangerSigns	string[]	Codes from RULES.dangerSigns that the provider ticked.
triageLevel	enum | null	"green" | "amber" | "red" — computed by RULES.triage (client and server must agree).
triageReasons	string[]	Human-readable reasons, from the rule table (en + np keys).
referral	object | null	Same shape as Visit.referral.
version	integer	
updatedAt	string (ISO)	
deleted	boolean	

Example JSON
{
  "id": "ac_f6f6f6f6-0000-4000-8000-000000000003",
  "pregnancyId": "pg_b2b2b2b2-0000-4000-8000-000000000001",
  "contactNo": 4,
  "weekTarget": 30,
  "dueAt": "2026-09-18",
  "doneAt": "2026-09-18T05:00:00.000Z",
  "providerUserId": "u_22222222-2222-4222-8222-222222222222",
  "findings": {
    "weightKg": 58,
    "bpSys": 150,
    "bpDia": 95,
    "fundalHeightCm": 29,
    "fhrBpm": 142,
    "hbGdl": 9.2,
    "urineProtein": "trace",
    "tdDoseGiven": false,
    "ifaGiven": true,
    "dewormingGiven": true,
    "calciumGiven": true,
    "fetalMovement": "normal"
  },
  "dangerSigns": [
    "SEVERE_HEADACHE_BLURRED_VISION"
  ],
  "triageLevel": "red",
  "triageReasons": [
    "BP ≥ 140/90 with severe headache — possible pre-eclampsia"
  ],
  "referral": {
    "facilityId": "f_0002",
    "facilityName": "Rapti Provincial Hospital",
    "reason": "Suspected pre-eclampsia",
    "urgency": "urgent"
  },
  "version": 1,
  "updatedAt": "2026-09-18T05:01:00.000Z",
  "deleted": false
}

Delivery
Outcome record that closes a Pregnancy (status → delivered). Syncable.
Field	Type	Notes
id	string (uuid)	CLIENT-generated.
pregnancyId	string	
deliveredAt	string (ISO)	
place	enum	"home" | "birthing_centre" | "hospital" | "on_the_way"
mode	enum	"normal" | "assisted" | "cs"
outcome	enum	"live_birth" | "stillbirth"
babyWeightKg	number | null	
babySex	enum | null	"female" | "male"
complications	string[]	Free text items.
version	integer	
updatedAt	string (ISO)	
deleted	boolean	

Example JSON
{
  "id": "dl_0001",
  "pregnancyId": "pg_b2b2b2b2-0000-4000-8000-000000000001",
  "deliveredAt": "2026-11-25T02:00:00.000Z",
  "place": "hospital",
  "mode": "normal",
  "outcome": "live_birth",
  "babyWeightKg": 2.9,
  "babySex": "female",
  "complications": [],
  "version": 1,
  "updatedAt": "2026-11-25T03:00:00.000Z",
  "deleted": false
}

Reminder
A scheduled SMS/push. Server-owned (not syncable); the app only reads them.
Field	Type	Notes
id	string	
patientId	string	
pregnancyId	string | null	
kind	enum	"anc_due" | "anc_missed" | "follow_up" | "medicine"
dueAt	string (ISO)	When to send.
channel	enum	"sms" | "push"
recipientPhone	string	
recipientRole	enum	"patient" | "family"
messageNp	string	Nepali text.
messageEn	string	
status	enum	"pending" | "sent" | "failed"
sentAt	string | null	

Example JSON
{
  "id": "rm_0001",
  "patientId": "p_a1a1a1a1-0000-4000-8000-000000000001",
  "pregnancyId": "pg_b2b2b2b2-0000-4000-8000-000000000001",
  "kind": "anc_due",
  "dueAt": "2026-09-17T03:00:00.000Z",
  "channel": "sms",
  "recipientPhone": "+9779801000009",
  "recipientRole": "family",
  "messageNp": "सीता चौधरीको ४ औं गर्भ जाँच २०८३-०६-०२ मा घोराही स्वास्थ्य चौकीमा छ।",
  "messageEn": "Sita Chaudhary's ANC contact 4 is due on 2026-09-18 at Ghorahi Health Post.",
  "status": "sent",
  "sentAt": "2026-09-17T03:00:05.000Z"
}

Facility
Health facility. Seeded by the backend for one district; read-only.
Field	Type	Notes
id	string	
name	string	
type	enum	"health_post" | "phcc" | "hospital" | "birthing_centre"
hasBirthingCentre	boolean	
phone	string | null	
lat	number	
lng	number	
municipality	string	
distanceKm	number | null	Only in /facilities/nearby responses.

Example JSON
{
  "id": "f_0002",
  "name": "Rapti Provincial Hospital",
  "type": "hospital",
  "hasBirthingCentre": true,
  "phone": "+97782560000",
  "lat": 28.0345,
  "lng": 82.4871,
  "municipality": "Tulsipur",
  "distanceKm": 14.2
}

AuditEntry
Who accessed a patient record. Server-owned; the patient can read their own.
Field	Type	Notes
id	string	
patientId	string	
actorUserId	string	
actorName	string	
actorFacilityName	string | null	
action	enum	"grant_created" | "grant_redeemed" | "record_viewed" | "visit_added" | "contact_recorded" | "document_added" | "grant_revoked"
at	string (ISO)	

Example JSON
{
  "id": "au_0001",
  "patientId": "p_a1a1a1a1-0000-4000-8000-000000000001",
  "actorUserId": "u_22222222-2222-4222-8222-222222222222",
  "actorName": "Ramesh Thapa (HA)",
  "actorFacilityName": "Ghorahi Health Post",
  "action": "grant_redeemed",
  "at": "2026-09-18T04:02:00.000Z"
}

CodeListItem
Picklist entries. Fetched once and cached on the device.
Field	Type	Notes
kind	enum	"complaint" | "diagnosis" | "drug" | "dangerSign" | "riskFactor"
code	string	
labelEn	string	
labelNp	string	
meta	object | null	For drug: { strength, form }. Otherwise null.

Example JSON
{
  "kind": "drug",
  "code": "METFORMIN_500",
  "labelEn": "Metformin 500 mg",
  "labelNp": "मेटफर्मिन ५०० मि.ग्रा.",
  "meta": {
    "strength": "500 mg",
    "form": "tablet"
  }
}

TimelineItem
Read-only union used by GET /patients/:id/timeline so the app renders one list.
Field	Type	Notes
kind	enum	"visit" | "document" | "pregnancy_registered" | "anc_contact" | "delivery"
at	string (ISO)	Sort key, descending.
title	string	Pre-formatted, e.g. "Visit — Ghorahi HP — E11 Diabetes"
subtitle	string | null	
badge	enum | null	"green" | "amber" | "red" | null
refId	string	Id of the underlying entity.
payload	object	The full underlying entity (Visit, Document, …) so no second call is needed.

Example JSON
{
  "kind": "anc_contact",
  "at": "2026-09-18T05:00:00.000Z",
  "title": "ANC contact 4 (week 30)",
  "subtitle": "BP 150/95 · Hb 9.2 · referred",
  "badge": "red",
  "refId": "ac_f6f6f6f6-0000-4000-8000-000000000003",
  "payload": {
    "…": "AncContact"
  }
}

A.3 Error codes
HTTP	error.code	When / what the app does
400	VALIDATION_ERROR	Body/query failed schema validation. details = { field: message }.
401	UNAUTHENTICATED	Missing/expired/invalid access token. App must refresh or re-login.
403	FORBIDDEN	Role not allowed, or no active grant for this patient.
403	GRANT_EXPIRED	QR token expired (10 min) or access window (24 h) ended.
404	NOT_FOUND	Entity does not exist or is soft-deleted.
409	VERSION_CONFLICT	Sync push: baseVersion ≠ current version. details = { current: <entity> }.
409	ALREADY_REDEEMED	Grant token already used by another provider.
422	RULE_VIOLATION	e.g. Pregnancy for a male patient, contactNo outside 1..8, delivery on non-active pregnancy.
429	RATE_LIMITED	OTP or grant creation too frequent.
500	INTERNAL	Unexpected. App shows a generic retry.

A.4 Endpoints
Every endpoint below lists method, path, auth, request body, and the exact success response. Placeholders like <Patient> mean "the full entity JSON from A.2".
Auth
POST /auth/otp/request
Auth: none   Purpose: Start login/registration. Demo build: OTP is always 123456 and no SMS is sent.
Request body
{
  "phone": "+9779801000001"
}

Success response
{
  "ok": true,
  "data": {
    "otpSentTo": "+9779801000001",
    "expiresInSec": 300,
    "demoOtp": "123456"
  }
}

•	Rate limit: 5 per phone per 10 min → 429 RATE_LIMITED.
•	demoOtp present only when SMS_MODE=mock.
POST /auth/otp/verify
Auth: none   Purpose: Verify OTP. Returns whether a PIN exists; if not, the app goes to Set-PIN.
Request body
{
  "phone": "+9779801000001",
  "otp": "123456"
}

Success response
{
  "ok": true,
  "data": {
    "tempToken": "<jwt 10 min>",
    "hasPin": false,
    "isNewUser": true
  }
}

POST /auth/pin/set
Auth: Bearer tempToken   Purpose: Create the account (if new) and set the 4-digit PIN.
Request body
{
  "pin": "4321",
  "name": "Sita Chaudhary"
}

Success response
{
  "ok": true,
  "data": {
    "accessToken": "<jwt 12 h>",
    "refreshToken": "<opaque 30 d>",
    "user": "<User>"
  }
}

POST /auth/pin/login
Auth: none   Purpose: Normal login.
Request body
{
  "phone": "+9779801000001",
  "pin": "4321"
}

Success response
{
  "ok": true,
  "data": {
    "accessToken": "<jwt 12 h>",
    "refreshToken": "<opaque 30 d>",
    "user": "<User>"
  }
}

•	5 wrong PINs → 429 for 15 min.
POST /auth/refresh
Auth: none   Purpose: Exchange refresh token.
Request body
{
  "refreshToken": "<opaque>"
}

Success response
{
  "ok": true,
  "data": {
    "accessToken": "<jwt 12 h>",
    "refreshToken": "<opaque 30 d>"
  }
}

POST /auth/provider/activate
Auth: Authorization: Bearer <accessToken>   Purpose: Upgrade the logged-in user to provider/fchv with an invite code (seeded). Demo codes: HA-GHORAHI-01 → provider @ Ghorahi HP; FCHV-W5-01 → fchv @ Ghorahi HP.
Request body
{
  "inviteCode": "HA-GHORAHI-01"
}

Success response
{
  "ok": true,
  "data": {
    "user": "<User with role=provider>"
  }
}

GET /me
Auth: Authorization: Bearer <accessToken>   Purpose: Current user.
Success response
{
  "ok": true,
  "data": {
    "user": "<User>"
  }
}

Patients (family profiles)
GET /patients
Auth: Authorization: Bearer <accessToken>   Purpose: Patients owned by me (patient role) — or patients I currently have an active grant for (provider role).
Success response
{
  "ok": true,
  "data": {
    "items": [
      "<Patient>",
      "<Patient>"
    ]
  }
}

POST /patients
Auth: Authorization: Bearer <accessToken>   Purpose: Create a family profile. Id is client-generated. Idempotent: same id twice → 200 with existing.
Request body
{
  "id": "p_a1a1a1a1-0000-4000-8000-000000000001",
  "name": "Sita Chaudhary",
  "sex": "female",
  "dob": "2002-04-11",
  "bloodGroup": "B+",
  "ward": 5,
  "municipality": "Ghorahi",
  "allergies": [],
  "chronicConditions": [],
  "emergencyContactPhone": "+9779801000009"
}

Success response
{
  "ok": true,
  "data": {
    "patient": "<Patient version=1>"
  }
}

GET /patients/:id
Auth: Authorization: Bearer <accessToken>   Purpose: Full patient with summary block used by the provider summary screen.
Success response
{
  "ok": true,
  "data": {
    "patient": "<Patient>",
    "summary": {
      "activeProblems": [
        {
          "code": "E11",
          "labelEn": "Type 2 diabetes",
          "labelNp": "मधुमेह",
          "since": "2021-03-01"
        }
      ],
      "currentMedicines": [
        "<Prescription>"
      ],
      "allergies": [
        "penicillin"
      ],
      "lastVitals": {
        "bpSys": 138,
        "bpDia": 88,
        "weightKg": 71.5,
        "at": "2026-09-18T04:05:00.000Z"
      },
      "activePregnancy": "<Pregnancy | null>",
      "lastVisitAt": "2026-09-18T04:05:00.000Z",
      "visitCount": 4
    }
  }
}

PATCH /patients/:id
Auth: Authorization: Bearer <accessToken>   Purpose: Update profile fields (owner only). Must send version; last-write-wins is NOT applied here — mismatched version → 409.
Request body
{
  "version": 3,
  "allergies": [
    "penicillin"
  ],
  "emergencyContactPhone": "+9779801000009"
}

Success response
{
  "ok": true,
  "data": {
    "patient": "<Patient version=4>"
  }
}

GET /patients/:id/timeline  ?limit=50&before=<ISO>
Auth: Authorization: Bearer <accessToken>   Purpose: Unified chronological feed.
Success response
{
  "ok": true,
  "data": {
    "items": [
      "<TimelineItem>"
    ],
    "nextBefore": "2026-06-01T00:00:00.000Z"
  }
}

GET /patients/:id/audit
Auth: Authorization: Bearer <accessToken>   Purpose: Owner only. Who accessed this record.
Success response
{
  "ok": true,
  "data": {
    "items": [
      "<AuditEntry>"
    ]
  }
}

Access grants (QR)
POST /grants
Auth: Authorization: Bearer <accessToken>   Purpose: Patient side. Creates a grant and returns the token to encode into the QR. QR payload string = "SWC1:" + token.
Request body
{
  "patientId": "p_a1a1a1a1-0000-4000-8000-000000000001",
  "scope": "append",
  "ttlMinutes": 10
}

Success response
{
  "ok": true,
  "data": {
    "grant": "<AccessGrant>",
    "token": "<jwt>",
    "qrPayload": "SWC1:<jwt>"
  }
}

•	Rate limit 20 per patient per hour.
•	Token claims: { typ:"grant", gid, pid, scope, exp }. Signed HS256 with GRANT_SECRET.
POST /grants/redeem
Auth: Authorization: Bearer <accessToken>   Purpose: Provider side after scanning. Returns the full bundle so the provider app can cache it for offline use.
Request body
{
  "qrPayload": "SWC1:<jwt>"
}

Success response
{
  "ok": true,
  "data": {
    "grant": "<AccessGrant redeemed, accessUntil=+24h>",
    "patient": "<Patient>",
    "summary": "<same summary object as GET /patients/:id>",
    "timeline": [
      "<TimelineItem> (latest 50)"
    ],
    "pregnancy": "<Pregnancy | null>",
    "ancContacts": [
      "<AncContact>"
    ]
  }
}

•	Role must be provider or fchv → else 403 FORBIDDEN.
•	Writes AuditEntry grant_redeemed.
•	Expired → 403 GRANT_EXPIRED; used by someone else → 409 ALREADY_REDEEMED.
POST /grants/:id/revoke
Auth: Authorization: Bearer <accessToken>   Purpose: Owner revokes; provider access ends immediately.
Success response
{
  "ok": true,
  "data": {
    "grant": "<AccessGrant revokedAt set>"
  }
}

Visits
POST /patients/:id/visits
Auth: Authorization: Bearer <accessToken>   Purpose: Provider with active append grant, or owner. Idempotent on id.
Request body
{
  "id": "v_c3c3c3c3-0000-4000-8000-000000000001",
  "visitAt": "2026-09-18T04:05:00.000Z",
  "chiefComplaintCode": "CC_POLYURIA",
  "vitals": {
    "bpSys": 138,
    "bpDia": 88,
    "pulse": 76,
    "weightKg": 71.5
  },
  "diagnosisCodes": [
    "E11"
  ],
  "notes": "Fasting sugar 168 mg/dl",
  "advice": "Diet, walk 30 min daily",
  "followUpAt": "2026-10-18",
  "referral": null,
  "prescriptions": [
    {
      "id": "rx_0001",
      "drugCode": "METFORMIN_500",
      "dose": "1 tab",
      "frequency": "BD",
      "durationDays": 30,
      "instructionsNp": "खाना पछि"
    }
  ],
  "supersedesId": null
}

Success response
{
  "ok": true,
  "data": {
    "visit": "<Visit>"
  }
}

•	Server fills providerUserId/providerName/facility from the token.
•	Creates Reminder follow_up if followUpAt set.
•	Writes AuditEntry visit_added.
GET /patients/:id/visits  ?limit=50
Auth: Authorization: Bearer <accessToken>   Purpose: List visits newest first.
Success response
{
  "ok": true,
  "data": {
    "items": [
      "<Visit>"
    ]
  }
}

Documents (paper capture)
POST /documents/presign
Auth: Authorization: Bearer <accessToken>   Purpose: Step 1: register metadata and get an upload URL.
Request body
{
  "id": "d_e5e5e5e5-0000-4000-8000-000000000001",
  "patientId": "p_a1a1a1a1-0000-4000-8000-000000000002",
  "type": "discharge",
  "title": "Bharatpur Hospital discharge sheet",
  "takenAt": "2026-07-02",
  "contentType": "image/jpeg",
  "sizeBytes": 240000
}

Success response
{
  "ok": true,
  "data": {
    "document": "<Document status=pending_upload>",
    "uploadUrl": "https://storage…/put?sig=…",
    "uploadMethod": "PUT",
    "uploadHeaders": {
      "Content-Type": "image/jpeg"
    },
    "expiresInSec": 900
  }
}

•	Max 2 MB; app compresses to ≤ 300 KB, 1600 px long edge.
POST /documents/:id/complete
Auth: Authorization: Bearer <accessToken>   Purpose: Step 2: after the PUT succeeded.
Success response
{
  "ok": true,
  "data": {
    "document": "<Document status=uploaded, downloadUrl set>"
  }
}

•	Writes AuditEntry document_added.
GET /documents/:id
Auth: Authorization: Bearer <accessToken>   Purpose: Metadata + fresh downloadUrl (1 h).
Success response
{
  "ok": true,
  "data": {
    "document": "<Document>"
  }
}

POST /documents/:id/summarize
Auth: Authorization: Bearer <accessToken>   Purpose: Optional AI draft summary (queued). Backend may return 501 if AI_MODE=off; app hides the button in that case (see GET /config).
Success response
{
  "ok": true,
  "data": {
    "document": "<Document aiSummaryStatus=queued>"
  }
}

Maternal
POST /patients/:id/pregnancies
Auth: Authorization: Bearer <accessToken>   Purpose: Register a pregnancy. Server computes edd (if lmp given), riskLevel, creates 8 AncContacts with deterministic ids and the Reminders. Patient must be female → else 422.
Request body
{
  "id": "pg_b2b2b2b2-0000-4000-8000-000000000001",
  "lmp": "2026-02-20",
  "edd": null,
  "gravida": 1,
  "para": 0,
  "riskFactors": [],
  "birthPlan": null
}

Success response
{
  "ok": true,
  "data": {
    "pregnancy": "<Pregnancy>",
    "ancContacts": [
      "<AncContact ×8, doneAt=null>"
    ]
  }
}

GET /pregnancies/:id
Auth: Authorization: Bearer <accessToken>   Purpose: Pregnancy with all contacts, delivery if any, and upcoming reminders.
Success response
{
  "ok": true,
  "data": {
    "pregnancy": "<Pregnancy>",
    "ancContacts": [
      "<AncContact ×8>"
    ],
    "delivery": "<Delivery | null>",
    "reminders": [
      "<Reminder>"
    ]
  }
}

PATCH /pregnancies/:id
Auth: Authorization: Bearer <accessToken>   Purpose: Update birthPlan / riskFactors / status=ended. Version required.
Request body
{
  "version": 2,
  "birthPlan": {
    "facilityId": "f_0002",
    "facilityName": "Rapti Provincial Hospital",
    "transport": "Neighbour's jeep",
    "moneySaved": true,
    "bloodDonorName": "Hari",
    "bloodDonorPhone": "+9779801000011",
    "companionName": "Mother-in-law"
  }
}

Success response
{
  "ok": true,
  "data": {
    "pregnancy": "<Pregnancy version=3>"
  }
}

PUT /pregnancies/:id/contacts/:contactNo
Auth: Authorization: Bearer <accessToken>   Purpose: Record a contact. Server recomputes triage with RULES and returns it; the app has already computed the same locally and MUST display the server value if they differ (log a warning).
Request body
{
  "doneAt": "2026-09-18T05:00:00.000Z",
  "findings": {
    "weightKg": 58,
    "bpSys": 150,
    "bpDia": 95,
    "fundalHeightCm": 29,
    "fhrBpm": 142,
    "hbGdl": 9.2,
    "urineProtein": "trace",
    "tdDoseGiven": false,
    "ifaGiven": true,
    "dewormingGiven": true,
    "calciumGiven": true,
    "fetalMovement": "normal"
  },
  "dangerSigns": [
    "SEVERE_HEADACHE_BLURRED_VISION"
  ],
  "referral": {
    "facilityId": "f_0002",
    "facilityName": "Rapti Provincial Hospital",
    "reason": "Suspected pre-eclampsia",
    "urgency": "urgent"
  }
}

Success response
{
  "ok": true,
  "data": {
    "ancContact": "<AncContact triageLevel=red, triageReasons=[…]>",
    "nearestReferral": "<Facility | null>"
  }
}

•	Cancels pending anc_missed reminder for this contact.
•	Writes AuditEntry contact_recorded.
POST /pregnancies/:id/delivery
Auth: Authorization: Bearer <accessToken>   Purpose: Close the pregnancy.
Request body
{
  "id": "dl_0001",
  "deliveredAt": "2026-11-25T02:00:00.000Z",
  "place": "hospital",
  "mode": "normal",
  "outcome": "live_birth",
  "babyWeightKg": 2.9,
  "babySex": "female",
  "complications": []
}

Success response
{
  "ok": true,
  "data": {
    "delivery": "<Delivery>",
    "pregnancy": "<Pregnancy status=delivered>"
  }
}

Reminders, facilities, code lists, config
GET /patients/:id/reminders
Auth: Authorization: Bearer <accessToken>   Purpose: Upcoming and recent reminders for a patient.
Success response
{
  "ok": true,
  "data": {
    "items": [
      "<Reminder>"
    ]
  }
}

GET /demo/sms
Auth: none   Purpose: Mock SMS outbox for the projector (only when SMS_MODE=mock). Also served as an HTML page at /demo/sms.html that auto-refreshes.
Success response
{
  "ok": true,
  "data": {
    "items": [
      {
        "to": "+9779801000009",
        "text": "सीता चौधरीको …",
        "sentAt": "2026-09-17T03:00:05.000Z"
      }
    ]
  }
}

GET /facilities/nearby  ?lat=28.03&lng=82.49&birthing=true&limit=5
Auth: Authorization: Bearer <accessToken>   Purpose: Nearest facilities by straight-line distance (Haversine).
Success response
{
  "ok": true,
  "data": {
    "items": [
      "<Facility with distanceKm>"
    ]
  }
}

GET /codelists  ?kind=drug (optional)
Auth: none   Purpose: All picklists in one call; cache on device with the returned version.
Success response
{
  "ok": true,
  "data": {
    "version": "2026-09-18.1",
    "items": [
      "<CodeListItem>"
    ]
  }
}

GET /rules
Auth: none   Purpose: The shared rule table (ancSchedule, dangerSigns, riskFactors, triage, reminders) with version. The app ships a copy and refreshes it on launch.
Success response
{
  "ok": true,
  "data": "<RULES object exactly as in the \"Shared rules\" chapter>"
}

GET /config
Auth: none   Purpose: Feature flags so the app can hide unavailable features.
Success response
{
  "ok": true,
  "data": {
    "smsMode": "mock",
    "aiSummaryEnabled": false,
    "otpDemo": true,
    "rulesVersion": "2026-09-18.1",
    "codelistVersion": "2026-09-18.1"
  }
}

Sync (offline-first)
POST /sync/push
Auth: Authorization: Bearer <accessToken>   Purpose: Push queued local changes in order. Each change is applied independently; the response reports per-change status. Never fails the whole batch.
Request body
{
  "deviceId": "dev_android_9f3a",
  "changes": [
    {
      "opId": "op_0001",
      "table": "visits",
      "op": "upsert",
      "rowId": "v_c3c3c3c3-0000-4000-8000-000000000001",
      "baseVersion": 0,
      "payload": "<Visit fields as in POST /patients/:id/visits + patientId>"
    },
    {
      "opId": "op_0002",
      "table": "anc_contacts",
      "op": "upsert",
      "rowId": "ac_f6f6f6f6-0000-4000-8000-000000000003",
      "baseVersion": 1,
      "payload": "<AncContact fields>"
    }
  ]
}

Success response
{
  "ok": true,
  "data": {
    "results": [
      {
        "opId": "op_0001",
        "status": "applied",
        "row": "<Visit version=1>"
      },
      {
        "opId": "op_0002",
        "status": "conflict",
        "current": "<AncContact version=2>"
      }
    ],
    "serverTime": "2026-09-18T05:10:00.000Z"
  }
}

•	status ∈ "applied" | "conflict" | "rejected" (with error {code,message}) | "duplicate" (opId already seen → treated as applied).
•	Tables allowed: patients, visits, documents(meta only), pregnancies, anc_contacts, deliveries.
•	baseVersion 0 = create. For append-only tables (visits, deliveries) a conflict can only happen on id collision.
GET /sync/pull  ?since=2026-09-18T04:00:00.000Z&deviceId=dev_android_9f3a
Auth: Authorization: Bearer <accessToken>   Purpose: All rows changed since cursor for the patients this user may see (owned, or active grant).
Success response
{
  "ok": true,
  "data": {
    "changes": [
      {
        "table": "anc_contacts",
        "row": "<AncContact>"
      },
      {
        "table": "patients",
        "row": "<Patient>"
      }
    ],
    "cursor": "2026-09-18T05:10:00.000Z",
    "hasMore": false
  }
}

•	Ordered by updatedAt asc; page size 200; repeat while hasMore.
•	Deleted rows come back with deleted=true.
A.5 Shared rules (RULES) — implemented in Dart AND TypeScript from this table
The rule table is versioned. The backend serves it at GET /rules; the app ships a copy in assets/rules.json and overwrites it at launch if the server version is newer. Both implementations must produce identical output for the same input; both sides write unit tests from the cases in A.6.
Verify before demo: confirm the 8-contact schedule and danger-sign wording against the current DoHS/Family Welfare Division ANC protocol. If the protocol you find differs, change this table (and only this table) and bump the version.
{
  "version": "2026-09-18.1",
  "ancSchedule": [
    {
      "contactNo": 1,
      "weekTarget": 12,
      "checklist": [
        "weight",
        "bp",
        "hb",
        "urineProtein",
        "ifa",
        "td1",
        "riskAssessment"
      ]
    },
    {
      "contactNo": 2,
      "weekTarget": 20,
      "checklist": [
        "weight",
        "bp",
        "fundalHeight",
        "ifa",
        "calcium",
        "deworming",
        "td2"
      ]
    },
    {
      "contactNo": 3,
      "weekTarget": 26,
      "checklist": [
        "weight",
        "bp",
        "fundalHeight",
        "fhr",
        "ifa",
        "calcium"
      ]
    },
    {
      "contactNo": 4,
      "weekTarget": 30,
      "checklist": [
        "weight",
        "bp",
        "fundalHeight",
        "fhr",
        "hb",
        "urineProtein",
        "ifa",
        "calcium",
        "birthPlan"
      ]
    },
    {
      "contactNo": 5,
      "weekTarget": 34,
      "checklist": [
        "weight",
        "bp",
        "fundalHeight",
        "fhr",
        "ifa",
        "calcium",
        "birthPlan"
      ]
    },
    {
      "contactNo": 6,
      "weekTarget": 36,
      "checklist": [
        "weight",
        "bp",
        "fundalHeight",
        "fhr",
        "urineProtein",
        "ifa",
        "calcium",
        "presentation"
      ]
    },
    {
      "contactNo": 7,
      "weekTarget": 38,
      "checklist": [
        "weight",
        "bp",
        "fundalHeight",
        "fhr",
        "ifa",
        "calcium"
      ]
    },
    {
      "contactNo": 8,
      "weekTarget": 40,
      "checklist": [
        "weight",
        "bp",
        "fundalHeight",
        "fhr",
        "ifa",
        "calcium",
        "labourSigns"
      ]
    }
  ],
  "dangerSigns": [
    {
      "code": "VAGINAL_BLEEDING",
      "level": "red",
      "en": "Vaginal bleeding",
      "np": "योनिबाट रगत बग्नु"
    },
    {
      "code": "CONVULSIONS",
      "level": "red",
      "en": "Convulsions / fits",
      "np": "काम्ने / मुर्छा पर्ने"
    },
    {
      "code": "SEVERE_HEADACHE_BLURRED_VISION",
      "level": "red",
      "en": "Severe headache with blurred vision",
      "np": "कडा टाउको दुखाइ र आँखा धमिलो"
    },
    {
      "code": "FEVER_WEAKNESS",
      "level": "red",
      "en": "High fever with weakness",
      "np": "उच्च ज्वरो र कमजोरी"
    },
    {
      "code": "SEVERE_ABDOMINAL_PAIN",
      "level": "red",
      "en": "Severe abdominal pain",
      "np": "पेट कडा दुख्ने"
    },
    {
      "code": "DIFFICULTY_BREATHING",
      "level": "red",
      "en": "Fast or difficult breathing",
      "np": "सास फेर्न गाह्रो"
    },
    {
      "code": "WATER_BREAK_PRETERM",
      "level": "red",
      "en": "Water breaking before 37 weeks",
      "np": "३७ हप्ता अघि पानी फुट्नु"
    },
    {
      "code": "REDUCED_FETAL_MOVEMENT",
      "level": "red",
      "en": "Reduced or absent fetal movement (after 20 wk)",
      "np": "बच्चा नचल्ने / कम चल्ने"
    },
    {
      "code": "SWELLING_FACE_HANDS",
      "level": "amber",
      "en": "Swelling of face and hands",
      "np": "अनुहार र हात सुन्निनु"
    },
    {
      "code": "PERSISTENT_VOMITING",
      "level": "amber",
      "en": "Persistent vomiting",
      "np": "लगातार बान्ता"
    }
  ],
  "riskFactors": [
    {
      "code": "AGE_LT_18",
      "en": "Age under 18",
      "np": "१८ वर्ष मुनि"
    },
    {
      "code": "AGE_GT_35",
      "en": "Age over 35",
      "np": "३५ वर्ष माथि"
    },
    {
      "code": "PREV_CS",
      "en": "Previous caesarean section",
      "np": "पहिले शल्यक्रिया"
    },
    {
      "code": "PREV_STILLBIRTH",
      "en": "Previous stillbirth / neonatal death",
      "np": "पहिले मृत जन्म"
    },
    {
      "code": "GRAND_MULTIPARA",
      "en": "Para ≥ 5",
      "np": "५ वा बढी सन्तान"
    },
    {
      "code": "MULTIPLE_PREGNANCY",
      "en": "Twins / multiple",
      "np": "जुम्ल्याहा"
    },
    {
      "code": "HEIGHT_LT_145",
      "en": "Height under 145 cm",
      "np": "उचाइ १४५ से.मि. मुनि"
    },
    {
      "code": "CHRONIC_ILLNESS",
      "en": "Chronic illness (diabetes, hypertension, heart, HIV)",
      "np": "दीर्घ रोग"
    }
  ],
  "triage": {
    "description": "Evaluate in order; the first matching level wins. Level red > amber > green.",
    "red": [
      "any dangerSigns code with level \"red\"",
      "findings.bpSys >= 160 OR findings.bpDia >= 110",
      "findings.bpSys >= 140 OR findings.bpDia >= 90, AND (urineProtein in [\"+\",\"++\",\"+++\"] OR SEVERE_HEADACHE_BLURRED_VISION ticked)",
      "findings.hbGdl < 7",
      "findings.fetalMovement == \"absent\" AND gestationalAgeDays >= 140"
    ],
    "amber": [
      "any dangerSigns code with level \"amber\"",
      "findings.bpSys >= 140 OR findings.bpDia >= 90",
      "findings.hbGdl >= 7 AND findings.hbGdl < 10",
      "findings.urineProtein in [\"+\",\"++\",\"+++\"]",
      "findings.fetalMovement == \"reduced\"",
      "pregnancy.riskLevel == \"high\""
    ],
    "green": [
      "otherwise"
    ],
    "action": {
      "red": "Refer NOW to nearest facility with birthing centre / hospital; show call button; set referral.urgency = \"urgent\".",
      "amber": "Advise facility delivery; schedule follow-up within 7 days; show nearest birthing centre.",
      "green": "Continue routine schedule."
    }
  },
  "reminders": {
    "anc_due": "Send 1 day before dueAt at 09:00 Asia/Kathmandu to patient phone and emergencyContactPhone (if set).",
    "anc_missed": "Send 3 days after dueAt if doneAt is still null; repeat once after 7 days.",
    "follow_up": "Send 1 day before Visit.followUpAt to patient phone."
  }
}

A.6 Shared test cases (both sides must pass)
#	Input	Expected
1	lmp = 2026-02-20	edd = 2026-11-27; contact 1 dueAt = 2026-05-15 (week 12); contact 5 dueAt = 2026-10-16 (week 34)
2	edd = 2026-11-27, lmp = null	lmp derived = 2026-02-20 for scheduling; gestationalAgeDays on 2026-09-18 = 210
3	findings { bpSys:150, bpDia:95 }, dangerSigns [SEVERE_HEADACHE_BLURRED_VISION]	red; reasons include the BP≥140/90 + headache rule
4	findings { bpSys:142, bpDia:88 }, no danger signs, riskLevel normal	amber (BP ≥ 140/90 only)
5	findings { hbGdl: 6.8 }	red (Hb < 7)
6	findings { hbGdl: 9.2 }	amber
7	findings { fetalMovement:"absent" }, gestationalAgeDays 150	red
8	findings { fetalMovement:"absent" }, gestationalAgeDays 120	not red by that rule (before 20 wk); evaluate the rest
9	no findings, dangerSigns [SWELLING_FACE_HANDS]	amber
10	no findings, no danger signs, riskFactors [PREV_CS]	amber (riskLevel high)
11	no findings, no danger signs, riskFactors []	green
12	Pregnancy for patient sex=male	422 RULE_VIOLATION on server; the app must not even show the Register Pregnancy button
13	Sync push visit with baseVersion 0 twice (same id)	first: applied v1; second: applied (idempotent), returns v1, no duplicate row
14	Sync push anc_contact baseVersion 1 when server has v2	conflict; response carries current row; app replaces local row with server row and re-applies only if user re-edits
15	Redeem grant after 10 min	403 GRANT_EXPIRED
16	Provider calls POST /patients/:id/visits 25 h after redeem	403 GRANT_EXPIRED (access window ended)

A.7 QR payload format
•	String: SWC1:<jwt>. The prefix lets the scanner reject foreign QR codes instantly. Version bump → SWC2.
•	JWT (HS256, GRANT_SECRET) claims: { typ:"grant", gid, pid, scope, iat, exp }. exp = iat + ttlMinutes×60.
•	Printed fallback card: the same payload with ttlMinutes = 525600 (1 year) and scope "read"; redeeming a long-lived token additionally requires the patient PIN in the request body (field pin). Build only if time allows; the doc marks it Tier 2.
A.8 Sync protocol (summary shared by both sides)
11.	Every local write on a syncable table also appends an outbox row {opId, table, op, rowId, baseVersion, payload, createdAt}.
12.	When online (connectivity change, app resume, manual "Sync now", or every 60 s in foreground), the app POSTs the outbox in createdAt order in batches of ≤ 50.
13.	For each result: applied → replace local row with returned row, delete outbox row. duplicate → same. conflict → replace local row with current, delete outbox row, show a non-blocking toast "Updated from server". rejected → keep row flagged sync_error with message; show in Sync Status screen.
14.	Then GET /sync/pull?since=<cursor> until hasMore=false; upsert rows by id where incoming.version > local.version; store the new cursor.
15.	AncContacts have deterministic ids on both sides: id = uuidv5(namespace "6ba7b810-9dad-11d1-80b4-00c04fd430c8", pregnancyId + ":" + contactNo). This is why a pregnancy created offline and its 8 contacts never duplicate the server-generated ones.
16.	Clocks: the app never uses its own clock for updatedAt; it uses serverTime from the last push to detect drift > 5 min and warns the user.
