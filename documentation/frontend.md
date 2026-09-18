Swasthya Card — Frontend Specification
Flutter mobile app · offline-first patient record + maternal care · 32-hour hackathon build
Owner: HEI (frontend)
Counterpart document: Swasthya Card — Backend Specification (Node.js)
Contract version: 2026-09-18.1
Generated: 18 September 2026
 
Contents


 
1. Purpose of this document
This is the complete build specification for the mobile app. It is written so that (a) the frontend developer can build the app without asking the backend developer questions, (b) the backend developer can see exactly what the app will send and expect, and (c) an AI coding agent can implement it end-to-end. Part A (the API contract) is byte-identical to Part A in the backend document.
Golden rule: the app must work with the network switched off for everything except login, QR share/redeem, uploads and audit. Build the local database and the sync engine first; screens are thin views over the local database.
2. Product summary
Swasthya Card is a patient-owned, offline-first health record for rural Nepal with a maternal-care module. Patients (or a family member's phone) hold the record, share it with any health worker through a 10-minute QR grant, and keep an audit of who looked. Health workers record visits with picklists in under a minute, photograph existing paper, and run the antenatal checklist with rule-based danger-sign triage that cites the national protocol. SMS reminders reach feature phones.
2.1 Roles and modes
Role	How obtained	Home screen	Can do
patient	Default after OTP + PIN	S06 Family list	Manage family profiles, share QR, view timeline/documents/audit/reminders, capture paper, register own pregnancy (female profile)
provider	Invite code HA-GHORAHI-01	S19 Provider home	Everything patient can do for own family + scan QR, add visits with prescriptions, ANC contacts, deliveries
fchv	Invite code FCHV-W5-01	S19 Provider home	Scan QR, register pregnancy, ANC contacts (no prescriptions), referrals, capture paper
admin	Not used in the app (dashboard is web, Tier 2)	—	—

2.2 Feature tiers (what to build in 32 hours)
Tier	Feature	Screens
1 — must	Phone+OTP(mock)+PIN auth; family profiles; encrypted local DB; outbox sync; QR share + redeem; provider summary; 60-second visit form; paper capture; pregnancy registration; ANC checklist + triage; pregnancy dashboard; timeline; reminders list; audit list; sync status; Nepali/English; BS dates	S01–S13, S15–S23
2 — if time	Delivery record; AI summary view; printed static QR with PIN; medicine reminder local notifications; nearest facility map (flutter_map)	S14 + extras
3 — roadmap	Child immunisation module; fine-grained consent; voice notes; PDF export	—

3. Technology stack
Concern	Choice	Why / notes
Framework	Flutter 3.x (stable), Dart 3, Android first (iOS if a Mac is available)	One codebase, both roles
State	flutter_riverpod ^2	Providers per feature; AsyncNotifier for lists
Navigation	go_router ^14	Role-based redirect in one place
Local DB	drift ^2 + sqlite3_flutter_libs; sqlcipher_flutter_libs for encryption	Typed queries, streams for reactive UI
HTTP	dio ^5	Interceptors for auth, retry, envelope parsing
Models	freezed + json_serializable	Immutable, generated fromJson/toJson matching Part A
Secure storage	flutter_secure_storage	Tokens, PIN hash, DB key
Connectivity	connectivity_plus	Trigger sync
QR	qr_flutter (render), mobile_scanner (scan)	
Camera/images	image_picker, flutter_image_compress	Compress to ≤ 300 KB
Nepali dates	nepali_utils, nepali_date_picker	BS ↔ AD conversion and pickers
i18n	flutter_localizations + intl (ARB: app_en.arb, app_ne.arb)	
IDs	uuid ^4 (v4 for new rows, v5 for anc_contacts)	
Phone/tel	url_launcher	Call button on referral
Notifications	flutter_local_notifications (Tier 2)	
Tests	flutter_test; mocktail	Rules engine tests are mandatory

4. Project structure
lib/
  main.dart                      // runApp with ProviderScope; reads dart-defines API_BASE_URL, MOCK_API
  app.dart                       // MaterialApp.router, theme, localization delegates
  router.dart                    // go_router routes S01–S23 + role redirect
  core/
    config/app_config.dart       // baseUrl (mutable, persisted), flags from GET /config
    l10n/                        // app_en.arb, app_ne.arb, generated
    dates/bs_date.dart           // toBs(DateTime) -> NepaliDateTime, format helpers
    ids/ids.dart                 // newId(), ancContactId(pregnancyId, contactNo) (uuid v5)
    errors/app_error.dart        // AppError{code,message,details} from envelope
    net/api_client.dart          // Dio + interceptors + unwrap()
    net/mock_api.dart            // in-memory implementation of every endpoint (Section 15)
    theme/
  data/
    local/app_database.dart      // Drift database + tables (Section 6)
    local/daos/*.dart
    local/outbox.dart
    remote/api/*.dart            // one class per endpoint group; returns freezed models
    repositories/                // PatientRepo, VisitRepo, DocumentRepo, PregnancyRepo, GrantRepo, ReminderRepo, AuditRepo, CodelistRepo
    sync/sync_engine.dart        // Section 7
    sync/upload_worker.dart      // documents presign/PUT/complete
  domain/
    models/*.dart                // freezed models = Part A entities
    rules/rules.dart             // RULES loader (asset + server)
    rules/edd.dart               // eddFromLmp, lmpFromEdd, gestationalAgeDays
    rules/anc_schedule.dart      // generateContacts(pregnancy) -> List<AncContact>
    rules/triage.dart            // triage(findings, dangerSigns, pregnancy, gaDays) -> TriageResult
    rules/reminders_preview.dart // (optional) local preview of reminder dates
  features/
    auth/          (S02–S05, S18)
    family/        (S06, S07)
    patient_home/  (S08)
    timeline/      (S09)
    documents/     (S10)
    maternal/      (S11–S14)
    reminders/     (S15)
    audit/         (S16)
    sync/          (S17)
    provider/      (S19–S22)
    settings/      (S23)
  shared/widgets/  // BsDateText, TriageBanner, SyncChip, PicklistField, NumberStepper, OfflineBanner
assets/
  rules.json                     // copy of RULES (Part A.5)
  codelists.json                 // seed copy so picklists work before first sync
  facilities.json                // seed copy
test/
  rules/edd_test.dart, anc_schedule_test.dart, triage_test.dart   // cases from Part A.6
  sync/sync_engine_test.dart

5. App configuration and environments
•	Dart defines: API_BASE_URL (default http://10.0.2.2:3000/api/v1 for emulator), MOCK_API=true|false.
•	Runtime override: Settings (S23) stores the base URL in shared preferences; ApiClient reads it on every request so the tunnel URL can change without a rebuild.
•	Flags from GET /config: smsMode (show "Demo SMS panel" hints), aiSummaryEnabled (show/hide summarise button), otpDemo (show demo OTP banner), rulesVersion / codelistVersion (refresh caches when newer).
•	Device id: generated once (uuid v4), stored in sync_meta, sent in every sync call.
6. Local database (Drift)
Tables mirror Part A entities one-to-one, with snake_case columns and JSON TEXT columns for nested objects. Every syncable table has version, updated_at, deleted. Three device-only tables are added: outbox, sync_meta and cached read-only tables.
Table	Columns	Notes
users	id PK, phone, role, name, facility_id, facility_name, created_at	Single row for the logged-in user.
patients	id PK, owner_user_id, name, sex, dob (TEXT YYYY-MM-DD), blood_group, ward, municipality, allergies (TEXT JSON), chronic_conditions (TEXT JSON), emergency_contact_phone, version INT, updated_at, deleted BOOL, access_until (nullable; set for provider-cached patients)	Mirror of Patient + one local column.
visits	id PK, patient_id, provider_user_id, provider_name, facility_id, facility_name, visit_at, chief_complaint_code, vitals (JSON), diagnosis_codes (JSON), notes, advice, follow_up_at, referral (JSON), prescriptions (JSON array), supersedes_id, version, updated_at, deleted	Prescriptions stored embedded as JSON (no separate table needed on device).
documents	id PK, patient_id, uploaded_by_user_id, type, title, taken_at, status, download_url, ai_summary, ai_summary_status, version, updated_at, deleted, local_path (nullable), upload_attempts INT	local_path + upload_attempts are device-only.
pregnancies	id PK, patient_id, lmp, edd, gravida, para, risk_factors (JSON), risk_level, status, birth_plan (JSON), registered_by_user_id, version, updated_at, deleted	
anc_contacts	id PK, pregnancy_id, contact_no, week_target, due_at, done_at, provider_user_id, findings (JSON), danger_signs (JSON), triage_level, triage_reasons (JSON), referral (JSON), version, updated_at, deleted	Deterministic ids (uuid v5).
deliveries	id PK, pregnancy_id, delivered_at, place, mode, outcome, baby_weight_kg, baby_sex, complications (JSON), version, updated_at, deleted	
reminders	id PK, patient_id, pregnancy_id, kind, due_at, channel, recipient_phone, recipient_role, message_np, message_en, status, sent_at	Read-only cache.
audit_entries	id PK, patient_id, actor_user_id, actor_name, actor_facility_name, action, at	Read-only cache.
facilities	id PK, name, type, has_birthing_centre, phone, lat, lng, municipality	Cached from /facilities/nearby (and a seeded asset copy).
codelist_items	kind, code, label_en, label_np, meta (JSON); PK (kind, code)	Cached from /codelists.
outbox	op_id PK, table_name, op, row_id, base_version, payload (JSON), created_at, attempts INT, last_error	The heart of offline-first.
sync_meta	key PK, value	Keys: pull_cursor, last_push_at, last_pull_at, device_id, rules_version, codelist_version, server_time_offset_ms.

6.1 Encryption
Open the database with SQLCipher using a 32-byte key derived from the PIN with PBKDF2-HMAC-SHA256 (100 000 iterations, per-device salt stored in secure storage). Wrong PIN → cannot open DB → the unlock screen shows the error. If SQLCipher setup costs more than one hour, ship unencrypted, keep the key derivation code, and state it on the slide.
6.2 Repositories (the only write path)
abstract class SyncableRepo<T> {
  Future<void> upsertLocal(T row);                 // writes the table row
  Future<void> enqueue(String table, String op, String rowId, int baseVersion, Map<String,dynamic> payload);
  Stream<List<T>> watchByPatient(String patientId); // Drift streams feed the UI
}
// Example: creating a visit
Future<void> addVisit(Visit v) async {
  await db.transaction(() async {
    await db.visitsDao.upsert(v.copyWith(version: 0));      // version 0 = not yet on server
    await outbox.enqueue(table: 'visits', op: 'upsert', rowId: v.id, baseVersion: 0, payload: v.toSyncJson());
  });
  syncEngine.kick();  // non-blocking
}

7. Sync engine (Dart)
One singleton, started after PIN unlock. It owns a mutex so only one push/pull cycle runs at a time.
class SyncEngine {
  // triggers: connectivity_plus onConnectivityChanged (online), app resume, manual kick(), Timer.periodic(60 s) while foreground
  Future<void> run() async {
    if (_running || !await _online()) return;
    _running = true;
    try {
      await _pushOutbox();     // batches of 50, createdAt asc
      await _uploadDocuments();// documents with status pending_upload and local_path
      await _pull();           // loop while hasMore
      await _refreshCaches();  // /config, /rules, /codelists if versions changed
      meta.set('last_push_at', now);
    } finally { _running = false; notify(); }
  }
  Future<void> _pushOutbox() async {
    final ops = await outbox.take(50);
    if (ops.isEmpty) return;
    final res = await api.sync.push(deviceId, ops);
    for (final r in res.results) {
      final op = ops.byId(r.opId);
      switch (r.status) {
        case 'applied': case 'duplicate': await table(op.table).upsertFromServer(r.row); await outbox.delete(op.opId);
        case 'conflict': await table(op.table).upsertFromServer(r.current); await outbox.delete(op.opId); toast('Updated from server');
        case 'rejected': await outbox.markError(op.opId, r.error.message);
      }
    }
    meta.set('server_time_offset_ms', res.serverTime - now);
    if (ops.length == 50) return _pushOutbox();
  }
  Future<void> _pull() async {
    var since = meta.get('pull_cursor') ?? '1970-01-01T00:00:00.000Z';
    while (true) {
      final r = await api.sync.pull(since, deviceId);
      for (final c in r.changes) await table(c.table).upsertIfNewer(c.row); // incoming.version > local.version
      since = r.cursor; meta.set('pull_cursor', since);
      if (!r.hasMore) break;
    }
  }
}

•	Rows with version 0 and a pending outbox op are shown in the UI with a small "pending" cloud icon.
•	Pull never overwrites a row that still has a pending outbox op (skip it; the push result will settle it).
•	A rejected op stays visible in S17 with the server message; the user can retry or discard (discard also deletes the local row if it was a create).
•	Document uploads: for each pending document → POST /documents/presign → PUT bytes (Dio, Content-Type from response) → POST /documents/:id/complete → update row; on failure increment upload_attempts, give up at 5.
8. Networking layer
class ApiClient {
  final Dio dio;  // baseUrl from AppConfig; connectTimeout 8 s; receiveTimeout 15 s
  // Interceptors (in order):
  // 1. AuthInterceptor: adds Authorization: Bearer <accessToken>; on 401 UNAUTHENTICATED tries POST /auth/refresh once, then retries; on failure logs out to S04.
  // 2. EnvelopeInterceptor: if body.ok == true -> response.data = body.data; else throw AppError(code, message, details, httpStatus).
  // 3. RetryInterceptor: network errors (no response) retried 2x with 1 s / 3 s backoff for GET only.
  // 4. LogInterceptor in debug.
}
// Every remote API method returns typed models, e.g.
Future<RedeemResult> redeem(String qrPayload) async {
  final d = await client.post('/grants/redeem', {'qrPayload': qrPayload});
  return RedeemResult.fromJson(d);
}

Error mapping in UI: AppError.code → localized message table (VALIDATION_ERROR → show field errors from details; GRANT_EXPIRED → "QR expired, ask for a new one"; ALREADY_REDEEMED → "Already used"; VERSION_CONFLICT → silent refresh; RATE_LIMITED → "Try later"; network → "You are offline — saved locally" when the action was a write, or "No connection" for reads).
9. State management (Riverpod)
Provider	Type	Source
authProvider	Notifier<AuthState{user, tokens, unlocked}>	secure storage + /auth/*
configProvider	FutureProvider<AppConfigFlags>	/config with cached fallback
rulesProvider	Provider<Rules>	assets/rules.json overridden by /rules
codelistProvider(kind)	StreamProvider<List<CodeListItem>>	Drift
familyProvider	StreamProvider<List<Patient>>	Drift patients where owner = me
patientProvider(id)	StreamProvider<Patient?>	Drift
patientSummaryProvider(id)	FutureProvider<Summary>	GET /patients/:id, fallback: computed locally from visits
timelineProvider(id)	StreamProvider<List<TimelineItem>>	Drift union + server refresh
pregnancyProvider(id)	StreamProvider<PregnancyBundle>	Drift pregnancies + anc_contacts + deliveries
triagePreviewProvider(input)	Provider<TriageResult>	pure function rules/triage.dart
syncStatusProvider	StreamProvider<SyncStatus{online, pending, lastSync, errors}>	SyncEngine
grantProvider	AsyncNotifier<ActiveGrant?>	POST /grants, countdown
providerPatientsProvider	StreamProvider<List<Patient>>	Drift patients where access_until > now

10. Navigation (go_router)
redirect: (ctx, state) {
  final auth = ref.read(authProvider);
  if (!auth.hasSession) return state.matchedLocation.startsWith('/auth') ? null : '/auth/phone';
  if (!auth.unlocked) return '/auth/pin';
  if (state.matchedLocation == '/') return auth.user.role == 'patient' ? '/family' : '/provider';
  return null;
}
routes: '/', '/auth/phone', '/auth/otp', '/auth/pin', '/auth/set-pin', '/family', '/family/new', '/family/:id/edit',
        '/patient/:id', '/patient/:id/timeline', '/patient/:id/documents', '/patient/:id/reminders', '/patient/:id/audit',
        '/patient/:id/pregnancy/new', '/pregnancy/:id', '/pregnancy/:id/contact/:no', '/pregnancy/:id/delivery',
        '/provider', '/provider/activate', '/provider/scan', '/provider/patient/:id', '/provider/patient/:id/visit/new',
        '/sync', '/settings'

11. Screens
For every screen: purpose, roles, entities it reads/writes, the endpoints involved, the UI, and the logic. Endpoints marked "via outbox" are never called directly from the screen — the repository writes locally and the sync engine sends them.
S01 — Splash / Bootstrap
Aspect	Specification
Route	/
Roles	all
Purpose	Open the encrypted local DB, load cached rules + codelists, decide where to go.
Entities	User (cached), RULES, CodeListItem
API	GET /config, GET /rules, GET /codelists (all fire-and-forget; failures are ignored and cached copies are used)
UI	Logo, progress indicator, base-URL gear icon (long-press opens Settings → Server URL).
Logic / validation	If no session → S02. If session and PIN set → S04 (PIN unlock). Refresh accessToken silently if < 1 h remaining.

S02 — Phone entry
Aspect	Specification
Route	/auth/phone
Roles	all
Purpose	Collect phone number and request OTP.
Entities	—
API	POST /auth/otp/request
UI	Phone field with +977 prefix, Nepali/English toggle, Continue button. Show demoOtp in a banner when config.otpDemo = true.
Logic / validation	Normalise to E.164. 429 → show "Try again in N minutes".

S03 — OTP entry
Aspect	Specification
Route	/auth/otp
Roles	all
Purpose	Verify OTP.
Entities	—
API	POST /auth/otp/verify
UI	6-box OTP input, resend countdown (60 s).
Logic / validation	hasPin=false → S05 Set PIN (with name). hasPin=true → S04 PIN unlock (store tempToken is not needed then).

S04 — PIN unlock
Aspect	Specification
Route	/auth/pin
Roles	all
Purpose	Daily login; derives the local DB key.
Entities	User
API	POST /auth/pin/login (only if no valid session; otherwise local-only unlock)
UI	4-digit keypad, "Forgot PIN → re-verify OTP" link.
Logic / validation	Offline: verify PIN against locally stored argon2/PBKDF2 hash and open DB without network. Online: also refresh tokens.

S05 — Set PIN + name
Aspect	Specification
Route	/auth/set-pin
Roles	all
Purpose	First-time account creation.
Entities	User
API	POST /auth/pin/set
UI	Name field, PIN, confirm PIN.
Logic / validation	On success store tokens (secure storage), PIN hash (secure storage), user (DB). Go to S06.

S06 — Family (patients) list — Patient mode home
Aspect	Specification
Route	/family
Roles	patient (also visible to providers for their own family)
Purpose	One phone, several people. Pick whose record to open.
Entities	Patient[]
API	GET /patients (on refresh), plus local DB read
UI	Cards: name, age (BS/AD), sex icon, badge "Pregnant · week 30" if activePregnancy, last visit date. FAB "Add family member". App-bar: sync status chip (S17), settings, "I am a health worker" (S18 activate).
Logic / validation	Read from local DB first (instant), then background sync. Empty state text in Nepali + English.

S07 — Add / edit patient
Aspect	Specification
Route	/family/new, /family/:id/edit
Roles	patient
Purpose	Create a family profile offline.
Entities	Patient
API	POST /patients or PATCH /patients/:id via sync outbox (never called directly)
UI	Name, sex, DOB (Nepali date picker with AD shown), blood group dropdown, ward, municipality, allergies chips, chronic conditions (picklist from codelist diagnosis), emergency contact phone.
Logic / validation	Generate UUID v4 locally; write row + outbox; navigate back immediately. Validation: name ≥ 2 chars; DOB ≤ today; phone E.164 if given.

S08 — Patient home (summary + QR)
Aspect	Specification
Route	/patient/:id
Roles	patient
Purpose	The "card": summary and the share QR.
Entities	Patient, summary block, Pregnancy, AccessGrant
API	GET /patients/:id (refresh), POST /grants (on "Share with health worker")
UI	Header: name, age, blood group, allergies (red chips). Big button "Share record (QR)". If active pregnancy: pregnancy card (week, next contact due, triage badge of last contact) → S12. Tabs/buttons: Timeline (S09), Documents (S10), Who viewed my record (S16), Reminders (S15).
Logic / validation	QR sheet: POST /grants {scope: "append", ttlMinutes: 10} → render qrPayload with qr_flutter at ≥ 240 px; countdown 10:00; "Regenerate" button; "Revoke" → POST /grants/:id/revoke. Requires network; if offline show "Sharing needs internet (or use printed card)".

S09 — Timeline
Aspect	Specification
Route	/patient/:id/timeline
Roles	patient, provider (via grant)
Purpose	Chronological feed of everything.
Entities	TimelineItem[] (built locally from Visit, Document, Pregnancy, AncContact, Delivery; server version used when online)
API	GET /patients/:id/timeline
UI	Grouped by BS month. Each row: icon by kind, title, subtitle, coloured badge. Tap → detail sheet showing payload (visit: vitals grid, diagnoses, prescriptions with Nepali instructions; document: image; contact: findings + triage).
Logic / validation	Local DB builds the same TimelineItem list so the screen works offline; when online, replace with server list (it is authoritative for titles).

S10 — Documents (capture paper)
Aspect	Specification
Route	/patient/:id/documents
Roles	patient, provider
Purpose	Photograph paper records.
Entities	Document
API	POST /documents/presign → PUT uploadUrl → POST /documents/:id/complete; GET /documents/:id; POST /documents/:id/summarize (only if config.aiSummaryEnabled)
UI	Grid of thumbnails with type chip and date. FAB camera → type picker → title → date (BS picker) → preview → Save. Detail: full image (pinch zoom), "AI draft summary" section with a visible "AI-generated, unverified" label.
Logic / validation	Compress with flutter_image_compress (1600 px, q=80). Save metadata row + local file path immediately (status pending_upload); the upload runs in the sync engine when online (presign → PUT → complete). Retry up to 5×.

S11 — Register pregnancy
Aspect	Specification
Route	/patient/:id/pregnancy/new
Roles	provider, fchv, patient(female)
Purpose	Start the maternal timeline.
Entities	Pregnancy, AncContact ×8, RULES
API	POST /patients/:id/pregnancies via outbox (table pregnancies); contacts are generated locally with deterministic ids and NOT pushed (server creates them); pulled later to reconcile
UI	LMP (BS picker) OR EDD; gravida/para steppers; risk-factor checklist (from RULES.riskFactors with Nepali labels); computed EDD in BS + AD live; "Register".
Logic / validation	Button hidden if patient.sex ≠ female or an active pregnancy exists. Compute schedule with rules/anc_schedule.dart; insert 8 anc_contacts rows (deterministic uuid v5); insert pregnancy + outbox.

S12 — Pregnancy dashboard
Aspect	Specification
Route	/pregnancy/:id
Roles	patient, provider, fchv
Purpose	Whole pregnancy on one screen.
Entities	Pregnancy, AncContact[], Delivery, Reminder[], Facility
API	GET /pregnancies/:id; GET /facilities/nearby?birthing=true
UI	Header: week X of 40, EDD (BS/AD), risk level chip. Stepper of 8 contacts: done (green/amber/red dot by triage), due, overdue (red outline). Tap a contact → S13. Birth plan card (edit → bottom sheet, PATCH via outbox). "Record delivery" button → S14. Reminders list (read-only).
Logic / validation	Overdue = dueAt < today and doneAt null. nearestReferral shown on red contacts.

S13 — ANC contact checklist + triage
Aspect	Specification
Route	/pregnancy/:id/contact/:no
Roles	provider, fchv
Purpose	The 60-second protocol form.
Entities	AncContact, RULES, Facility
API	PUT /pregnancies/:id/contacts/:no via outbox (table anc_contacts, baseVersion = local version)
UI	Section 1 findings: numeric steppers for weight, BP sys/dia, fundal height, FHR, Hb; segmented control for urine protein and fetal movement; toggles for Td/IFA/deworming/calcium. Only fields in RULES.ancSchedule[contactNo].checklist are expanded; others collapsed under "More". Section 2 danger signs: big tappable tiles with Nepali + English label, red tiles for level=red. Section 3 (auto): triage result banner (green/amber/red) with reasons; if red/amber: nearest birthing facility card with "Call" (url_launcher tel:) and "Set referral" (prefilled). Save.
Logic / validation	Triage is computed live on every change with rules/triage.dart. On save: write contact row with triageLevel/reasons, outbox op. When the server result arrives via push response, if triageLevel differs → overwrite local and log warning (should never happen if tests pass).

S14 — Record delivery
Aspect	Specification
Route	/pregnancy/:id/delivery
Roles	provider, fchv, patient
Purpose	Close the pregnancy.
Entities	Delivery, Pregnancy
API	POST /pregnancies/:id/delivery via outbox (table deliveries)
UI	Date/time, place, mode, outcome, baby weight, baby sex, complications chips.
Logic / validation	Locally set pregnancy.status = delivered (server does the same on apply).

S15 — Reminders
Aspect	Specification
Route	/patient/:id/reminders
Roles	patient
Purpose	Show what SMS went/will go where.
Entities	Reminder[]
API	GET /patients/:id/reminders
UI	List with kind icon, due date (BS), recipient role, status chip.
Logic / validation	Read-only; when SMS mode is mock, add a hint "Demo: see the SMS panel".

S16 — Who viewed my record (audit)
Aspect	Specification
Route	/patient/:id/audit
Roles	patient (owner)
Purpose	Trust feature for the demo.
Entities	AuditEntry[]
API	GET /patients/:id/audit
UI	List: actor name, facility, action label (Nepali/English), relative time.
Logic / validation	Online only; cache last result.

S17 — Sync status
Aspect	Specification
Route	/sync
Roles	all
Purpose	Make offline-first visible.
Entities	Outbox, SyncMeta
API	POST /sync/push, GET /sync/pull
UI	Pending ops count, last sync time, "Sync now", list of failed ops with message and "Retry"/"Discard".
Logic / validation	Also the status chip in app bars: grey = offline, amber = N pending, green = synced.

S18 — Provider activation
Aspect	Specification
Route	/provider/activate
Roles	patient → provider/fchv
Purpose	Turn this phone into a health-worker phone.
Entities	User
API	POST /auth/provider/activate
UI	Invite code field; on success show facility name and switch the home to S19.
Logic / validation	Store user.role locally; router redirects by role.

S19 — Provider home
Aspect	Specification
Route	/provider
Roles	provider, fchv
Purpose	Scan, and see recently accessed patients.
Entities	Patient[] (cached bundles), AccessGrant
API	GET /patients (provider role → patients with active grants)
UI	Big "Scan patient QR" button → S20. List "Recent patients (access until …)" → S21. Switch to "My family" (S06).
Logic / validation	Cached bundles expire at accessUntil; hide after that.

S20 — QR scanner
Aspect	Specification
Route	/provider/scan
Roles	provider, fchv
Purpose	Redeem a grant.
Entities	AccessGrant, Patient bundle
API	POST /grants/redeem
UI	mobile_scanner full screen with torch toggle; overlay text "Ask the patient to open Share record".
Logic / validation	Accept only payloads starting with "SWC1:". Requires network (show clear message otherwise). On success: store patient, summary, timeline, pregnancy, contacts in local DB with accessUntil; navigate to S21.

S21 — Provider patient summary
Aspect	Specification
Route	/provider/patient/:id
Roles	provider, fchv
Purpose	Ten-second read of what matters.
Entities	Patient, summary, Pregnancy, AncContact
API	GET /patients/:id (refresh if online)
UI	Top: name, age, sex, blood group, ALLERGIES in red. Cards: Active problems, Current medicines (Nepali instructions), Last vitals, Active pregnancy (week, next contact, last triage) → S12/S13. Buttons: "Add visit" (S22), "Capture paper" (S10), "Timeline" (S09), "Register pregnancy" (S11, female only).
Logic / validation	Works offline from cached bundle; banner "Offline — showing record from HH:MM; new entries will sync later".

S22 — Add visit (60-second form)
Aspect	Specification
Route	/provider/patient/:id/visit/new
Roles	provider (fchv: read-only, cannot prescribe)
Purpose	Structured encounter.
Entities	Visit, Prescription, CodeListItem
API	POST /patients/:id/visits via outbox (table visits, baseVersion 0)
UI	Chief complaint: searchable picklist (Nepali/English). Vitals: numeric row. Diagnoses: multi-select picklist. Medicines: add row → drug picklist, dose, frequency segmented (OD/BD/TDS/QID/SOS/HS), days, Nepali instruction chips ("खाना पछि", "खाना अघि", "सुत्ने बेला"). Advice, follow-up date (BS picker), referral toggle → facility picker + reason + urgency. Save.
Logic / validation	Generate visit id and prescription ids locally; write + outbox; return to S21 with a snackbar "Saved · will sync". fchv role: hide medicines section.

S23 — Settings
Aspect	Specification
Route	/settings
Roles	all
Purpose	Language, server URL, PIN change, logout, about/rules version.
Entities	—
API	GET /config
UI	Language toggle, server URL field (with "Test connection" → GET /config), rules version, codelist version, "Refresh lists", logout (wipes DB after confirmation).
Logic / validation	—

12. Rules engine in Dart (must match Part A.5 and pass A.6)
// domain/rules/edd.dart
DateTime eddFromLmp(DateTime lmp) => lmp.add(const Duration(days: 280));
DateTime lmpFromEdd(DateTime edd) => edd.subtract(const Duration(days: 280));
int gestationalAgeDays(DateTime edd, DateTime today) => today.difference(lmpFromEdd(edd)).inDays;
 
// domain/rules/anc_schedule.dart
List<AncContact> generateContacts(Pregnancy p, Rules r) => r.ancSchedule.map((s) => AncContact(
  id: ancContactId(p.id, s.contactNo),                      // uuid v5, see core/ids
  pregnancyId: p.id, contactNo: s.contactNo, weekTarget: s.weekTarget,
  dueAt: lmpFromEdd(p.edd).add(Duration(days: s.weekTarget * 7)),
  doneAt: null, findings: null, dangerSigns: const [], triageLevel: null, triageReasons: const [],
  referral: null, version: 0, updatedAt: null, deleted: false)).toList();
 
// domain/rules/triage.dart
class TriageResult { final String level; final List<String> reasonsEn; final List<String> reasonsNp; }
TriageResult triage({required Findings? f, required List<String> dangerSigns, required Pregnancy p, required int gaDays, required Rules r}) {
  final reasons = <String>[];
  bool red = false, amber = false;
  final redSigns = dangerSigns.where((c) => r.dangerSign(c)?.level == 'red');
  if (redSigns.isNotEmpty) { red = true; reasons.addAll(redSigns.map((c) => r.dangerSign(c)!.en)); }
  if (f != null) {
    final sys = f.bpSys ?? 0, dia = f.bpDia ?? 0;
    if (sys >= 160 || dia >= 110) { red = true; reasons.add('Severe hypertension (≥160/110)'); }
    final protein = ['+', '++', '+++'].contains(f.urineProtein);
    if ((sys >= 140 || dia >= 90) && (protein || dangerSigns.contains('SEVERE_HEADACHE_BLURRED_VISION'))) { red = true; reasons.add('BP ≥ 140/90 with proteinuria or severe headache — possible pre-eclampsia'); }
    if ((f.hbGdl ?? 99) < 7) { red = true; reasons.add('Severe anaemia (Hb < 7)'); }
    if (f.fetalMovement == 'absent' && gaDays >= 140) { red = true; reasons.add('Absent fetal movement'); }
    if (!red) {
      if (sys >= 140 || dia >= 90) { amber = true; reasons.add('Raised BP (≥140/90)'); }
      if ((f.hbGdl ?? 99) >= 7 && (f.hbGdl ?? 99) < 10) { amber = true; reasons.add('Anaemia (Hb 7–9.9)'); }
      if (protein) { amber = true; reasons.add('Proteinuria'); }
      if (f.fetalMovement == 'reduced') { amber = true; reasons.add('Reduced fetal movement'); }
    }
  }
  if (!red) {
    final amberSigns = dangerSigns.where((c) => r.dangerSign(c)?.level == 'amber');
    if (amberSigns.isNotEmpty) { amber = true; reasons.addAll(amberSigns.map((c) => r.dangerSign(c)!.en)); }
    if (p.riskLevel == 'high') { amber = true; reasons.add('High-risk pregnancy (risk factors present)'); }
  }
  return TriageResult(level: red ? 'red' : amber ? 'amber' : 'green', reasonsEn: reasons, reasonsNp: reasons.map(r.translateReason).toList());
}

The backend implements the same function in TypeScript. The 16 cases in Part A.6 are the shared unit tests. If the two ever disagree at runtime, the app shows the server value and logs a warning — but this should be caught by tests, not in the demo.
13. Localisation and Bikram Sambat dates
•	Two ARB files. Default locale = device locale if ne/en, else ne. Toggle in S23 and on the phone-entry screen.
•	All dates displayed as BS primary, AD secondary: e.g. "२०८३ असोज २ (2026-09-18)". Helper widget BsDateText(DateTime).
•	Pickers: nepali_date_picker for DOB/LMP/follow-up; convert to AD with nepali_utils before storing. Store AD only.
•	Nepali numerals option (NepaliUnicode/ NepaliNumberFormat) for the Nepali locale; keep Latin digits for vitals input fields to avoid confusion.
•	Codelist and rule labels come with labelEn/labelNp; pick by locale with a fallback to English.
14. QR share and scan
•	Patient side (S08): POST /grants → qrPayload → QrImageView(data: qrPayload, size: 260, errorCorrectionLevel: M). Show the countdown from grant.expiresAt using server time offset. Regenerate on tap. Revoke button.
•	Provider side (S20): MobileScanner(onDetect) → take the first barcode whose rawValue starts with "SWC1:" → POST /grants/redeem → write bundle to Drift (patients row gets access_until) → go to S21. Ignore other QR codes with a small toast.
•	Both need network; show "Internet required to share/redeem" if offline. The cached bundle makes all later provider work offline.
15. Mock API mode (build the app before the backend exists)
core/net/mock_api.dart implements every endpoint in Part A against in-memory maps, seeded with the example JSON from Part A.2 (Sita with a week-30 pregnancy, Ram with diabetes and one visit). It must return the exact same shapes. Behaviour to emulate: OTP 123456; PIN any 4 digits; grants expire after 10 min; redeem returns the bundle; sync push returns applied with version+1; pull returns nothing new; /demo/sms returns the two seeded reminders. Switch with --dart-define=MOCK_API=true. Keep it until the last hour — it is also the fallback if the backend is down during the demo.
16. UX conventions (offline, errors, empty states)
•	Every list screen: skeleton loader → content or empty-state illustration with a one-line Nepali/English message and the primary action.
•	Writes never block on network: save locally, pop the screen, show snackbar "Saved · will sync" (or "Saved · synced" if online and push succeeded within 2 s).
•	A persistent thin OfflineBanner at the top of provider screens when offline: "Offline — showing record from HH:MM".
•	Red triage banner uses colour AND an icon AND text (accessibility).
•	Minimum tap target 48 dp; forms use large numeric steppers; never require typing for vitals.
•	Provider summary shows allergies in a red chip row at the top, always, even if empty ("No known allergies").
17. Test and acceptance checklist
1.	Rules unit tests: all 16 cases in Part A.6 pass.
2.	Fresh install → OTP → set PIN → add family member → visible in list without network.
3.	Airplane mode: add a visit as provider on a cached patient → pending icon → network on → synced within 60 s and visible on the patient phone after its pull.
4.	QR: generate on phone 1, scan on phone 2, summary shows allergies and pregnancy; expired QR gives the proper message.
5.	ANC contact with BP 150/95 + severe headache → red banner + referral card + call button; saved contact shows red dot on the dashboard.
6.	Document capture → thumbnail immediately → uploaded status after sync.
7.	Timeline shows visit, document and contact in correct BS-month groups.
8.	Audit list shows the provider's redeem and visit.
9.	Language toggle switches every visible string.
10.	Release APK installs and camera + scanner work in release mode.
18. 32-hour plan (frontend)
Hours	Deliverable
0–2	Scaffold, packages, theme, l10n skeleton, router with role redirect, Drift schema compiled, freezed models generated from Part A.
2–5	ApiClient + envelope + mock API seeded; auth screens S02–S05; secure storage.
5–8	Rules engine + 16 unit tests; ids (v4/v5); BS date helpers.
8–12	S06 family list, S07 add patient (offline), outbox + SyncEngine push/pull against mock, S17 sync status chip.
12–15	S08 patient home + QR sheet; S19 provider home; S20 scanner; S21 provider summary from cached bundle.
15–19	S22 add visit (picklists, prescriptions); S09 timeline (local union).
19–24	S11 register pregnancy, S12 dashboard, S13 checklist + live triage + referral card.
24–27	S10 documents capture + upload worker; S15 reminders; S16 audit; S23 settings.
27–29	Switch to real backend; fix contract mismatches together; release APK; two-phone rehearsal.
29–32	Polish demo path only; S14 delivery if time; freeze.

19. Instructions for an AI coding agent
You are implementing the Flutter mobile app "Swasthya Card" for a 32-hour hackathon.
Read the whole document first, especially Part A (API contract) and Section 12 (rules).
Rules for you:
1. Never change a JSON field name, enum value, or endpoint path from Part A. If something is missing, add a TODO comment and use a sensible default; do not invent new endpoints.
2. Build in this order: project scaffold → Drift schema → ApiClient + envelope parsing → mock API (Section 15) → rules engine + unit tests (A.6) → S04/S06/S07 → S08 QR → S20/S21 → S22 → S11/S12/S13 → S09 → S10 → S17 → the rest.
3. Every write to a syncable table goes through a Repository that also writes the outbox. No screen calls the network directly for writes.
4. Every screen must have loading, empty, error and offline states.
5. Use flutter_riverpod (code-gen optional), go_router, drift, dio, freezed for models. Do not add state libraries beyond Riverpod.
6. All user-visible strings go through l10n (en + ne ARB files). Dates displayed in Bikram Sambat with AD in smaller text.
7. Generate Dart models from the JSON examples in Part A. Field names must map camelCase JSON ↔ camelCase Dart 1:1.
8. Keep a MOCK_API flag (dart-define) so the app runs fully without the backend.
9. After each milestone, run "flutter analyze" and the unit tests; do not proceed with analyzer errors.
10. Produce a release APK ("flutter build apk --release --dart-define=API_BASE_URL=...") at the end.

 
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
