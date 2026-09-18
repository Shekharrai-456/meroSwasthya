# Architecture — Swasthya Card Backend

Every component below is justified by at least one REQ ID from `docs/REQUIREMENTS.md`. The directory tree, module boundaries, and most cross-cutting behaviour are fixed by `documentation/backend.md` §4/§9 — this document formalizes *why* each piece exists and how requests flow through it, per CLAUDE.md §7's layering rule.

## 1. Layers and their boundaries

```
route (Fastify handler)  → parses request, calls requireAuth/requireRole, delegates. No business logic, no Prisma calls.
  ↓
service (module service.ts) → all business rules, state transitions, transactions, calls to repositories/other services.
  ↓
repository (Prisma calls, embedded directly in service.ts for this codebase size — see note below)
  ↓
serializer (lib/serializers.ts) → the ONLY place that turns a Prisma row into API JSON (REQ-API-007)
```

**Why no separate repository files:** CLAUDE.md §7's layering rule ("no ORM queries in routers... repositories hold queries") is honored by keeping Prisma calls out of route handlers, but this project is small enough (nine modules, no complex query composition reused across modules) that a full repository-class layer per module would be an abstraction with no requirement behind it — CLAUDE.md's own anti-over-engineering rule ("every layer must have a stated reason tied to a requirement") cuts the other way here. Prisma calls live at the top of each `service.ts`, directly below the business-rule functions that use them, so a service file reads top-to-bottom as "rules, then the queries the rules need." If a module's queries grow complex enough to need reuse or independent testing (this is realistically only `sync/service.ts` and `patients/summary.ts`/`timeline.ts`), split that module's queries into a sibling file at that point — not in advance.

**Route → service → serializer, never route → serializer directly and never route → Prisma directly.** This is the one layering rule enforced everywhere, because it's what REQ-API-007 (no raw Prisma objects ever returned) depends on.

## 2. Directory tree

Fixed by backend.md §4, reproduced here as the binding structure for Session 2:

```
backend/
  docker-compose.yml
  .env.example
  package.json
  prisma/schema.prisma
  prisma/seed.ts
  src/
    server.ts              # builds the Fastify app, registers plugins/routes, listens
    app.ts                 # buildApp() factory used by both server.ts and tests
    config.ts              # zod-validated environment config (REQ-API config, REQ-SEC-002)
    plugins/
      envelope.ts           # reply.ok(data) helper + global error handler (REQ-API-001..004)
      auth.ts                # requireAuth/requireRole/canReadPatient/canAppendPatient (REQ-ROLE-002..004)
      ratelimit.ts           # @fastify/rate-limit config (REQ-SEC-001)
    lib/
      ids.ts                 # ancContactId() uuid v5 (REQ-PREG-004, REQ-SYNC-023)
      dates.ts               # toDateOnly/toIso/Kathmandu-09:00 helper (REQ-API-008, REQ-PREG-006)
      serializers.ts         # one toXDto() per entity (REQ-API-007)
      errors.ts              # AppError + error codes (REQ-API-001, Part A.3)
    modules/
      auth/       routes.ts service.ts schemas.ts
      patients/   routes.ts service.ts schemas.ts summary.ts timeline.ts
      grants/     routes.ts service.ts schemas.ts
      visits/     routes.ts service.ts schemas.ts
      documents/  routes.ts service.ts storage.ts ai.worker.ts
      maternal/   routes.ts service.ts schemas.ts rules/{rules.json, edd.ts, schedule.ts, triage.ts}
      reminders/  routes.ts service.ts worker.ts sms/{adapter.ts, mock.ts, sparrow.ts} templates.ts
      sync/       routes.ts service.ts schemas.ts
      facilities/ routes.ts
      codelists/  routes.ts
      meta/       routes.ts     # /rules, /config, /demo/sms(.html)
      audit/      service.ts    # no routes.ts — audit is written by other modules, read via patients/routes.ts
    workers.ts               # starts BullMQ workers (single process for the hackathon)
  test/
    rules.test.ts sync.test.ts grants.test.ts  # + one *.test.ts per module added in its own session
  public/demo-sms.html
```

Each `modules/*` directory is one vertical slice (REQ area) — `auth`↔AUTH/ROLE reqs, `patients`↔PATIENT reqs, `grants`↔GRANT reqs, `visits`↔VISIT reqs, `documents`↔DOC reqs, `maternal`↔PREG/RULES reqs, `reminders`↔REMIND reqs, `sync`↔SYNC reqs, `facilities`/`codelists`/`meta`↔FACILITY/CODELIST/META reqs. No module exists without a REQ area behind it.

## 3. Request lifecycle

```
1. Fastify receives request → global request-id + pino logger context attached (REQ-API log line: method,path,status,ms,userId)
2. Rate-limit plugin checks route-specific limits (REQ-SEC-001) → 429 RATE_LIMITED if exceeded
3. Route handler:
   a. requireAuth() → 401 UNAUTHENTICATED if no valid access token (skipped for "Auth: none" endpoints)
   b. zod schema.parse(request.body/query/params) → 400 VALIDATION_ERROR on failure (REQ-API-002)
   c. requireRole(...) and/or canReadPatient/canAppendPatient(...) → 403 FORBIDDEN / GRANT_EXPIRED (REQ-ROLE-002..004)
4. Route calls the module's service function, passing already-validated, already-authorized input
5. Service opens a Prisma transaction if the operation touches >1 table (REQ-SYNC-001, REQ-PREG-004, REQ-GRANT-006) —
   one unit of work per request; commit at the end; any thrown error rolls the whole transaction back
6. Service returns plain data (or throws AppError)
7. Route passes the result through the matching serializer, then reply.ok(data) (REQ-API-004/007)
8. On any thrown error, the global error handler (step in plugins/envelope.ts) converts it to the
   {ok:false,error:{code,message,details}} envelope with the correct HTTP status (REQ-API-001)
```

**Where validation happens:** exclusively in `modules/*/schemas.ts` (zod), called at the top of the route handler, before any service code runs. Services trust their inputs are already shape-valid; they only enforce *business* rules (e.g. "patient must be female" — REQ-PREG-001) that zod cannot express.

**Where authorization happens:** `requireAuth`/`requireRole` run in the route handler (they only need the token, not domain data). `canReadPatient`/`canAppendPatient` also run in the route handler once the target `patientId` is known from the URL/body, *before* the service is called — the service layer never re-derives authorization, it receives an already-authorized call. The one exception is `sync/service.ts`, which must re-check authorization **per change** inside the push loop (REQ-SYNC-003), because a single batch mixes multiple patients/tables that can't all be pre-checked by the route.

## 4. Error handling strategy

One `AppError { code, httpStatus, message, details? }` class (`lib/errors.ts`), thrown from anywhere in a service. `plugins/envelope.ts` registers a single Fastify `setErrorHandler` that:
- maps a thrown `AppError` straight through to its `httpStatus`/`code`/`message`/`details` (REQ-API-001)
- maps a zod `ZodError` (if it somehow escapes the schema-validation step) to 400 `VALIDATION_ERROR` with per-field `details` (REQ-API-002)
- maps anything else to 500 `INTERNAL`, logs the full stack via pino at `error` level, and returns only the generic envelope — no stack, no SQL, no internal message (REQ-API-003, REQ-SEC-004)

No route or service ever constructs a raw HTTP response for an error path — every failure is a `throw new AppError(...)`, caught in exactly one place.

## 5. Logging

`pino` (JSON in all environments; `pino-pretty` piped in dev only) attached as a Fastify logger. Every request logs `{method, path, status, ms, userId, requestId}` on completion (CLAUDE.md §7 logging rule; backend.md §14 rule 8). A `requestId` (uuid, generated per request) is attached to the Fastify request context and included on every log line for that request, so a support engineer can grep one request's full trace. **Never logged, at any level:** PIN, OTP, JWT/refresh token values, SMS message bodies, raw webhook-style payloads if any are added later (REQ-SEC-004).

## 6. Configuration

`src/config.ts` parses `process.env` through a single zod schema at startup and fails loudly (process exit, not a silently-undefined value) if a required variable is missing or malformed — no hard-coded URLs, hosts, keys, or limits anywhere else in the codebase (CLAUDE.md §7). Every variable in backend.md §5's environment table becomes one field of this schema; `.env.example` is committed with every key present and a dummy value, `.env` is git-ignored (Session 2 deliverable, REQ tracked in PROJECT_PLAN.md under Foundation).

## 7. Transactions

Every service function that writes to more than one table wraps its writes in a single `prisma.$transaction(...)`:
- `POST /patients/:id/pregnancies` — pregnancy + 8 AncContacts + reminders (REQ-PREG-004/006/007)
- `POST /grants/redeem` — grant update + AuditEntry (REQ-GRANT-006)
- `PUT /pregnancies/:id/contacts/:no` — contact update + reminder cancellation + AuditEntry (REQ-PREG-012/014)
- `POST /sync/push` — each individual change is its own transaction (REQ-SYNC-001: "each change is applied independently... never fails the whole batch" — this is *why* each change gets its own transaction rather than one transaction for the whole batch)
- `POST /patients/:id/visits` — visit + reminder (if `followUpAt`) + AuditEntry (REQ-VISIT-005/006)

Commit happens once, at the end of the service function; any unhandled exception inside the transaction callback rolls it back automatically (Prisma's `$transaction` semantics) — this satisfies CLAUDE.md §7's "commit at the service boundary, never mid-loop."

## 8. Background work

Two BullMQ queues, started by `workers.ts` in the same process as the API (documented hackathon simplification — a real deployment would split them):
- **`reminders`** — repeatable job, `every: 60_000`, drains up to 100 due reminders per tick, sends via the configured `SmsAdapter`, retries up to 3 times before marking `failed` (REQ-REMIND-001..003)
- **`ai-summary`** — one job per `POST /documents/:id/summarize` call, downloads the object, calls the vision LLM, writes back `aiSummary`/`aiSummaryStatus` (REQ-DOC-006/007). Tier 2 — only active when `AI_MODE=on`.

Both queues are the *only* background work in the system — there is no generic job-runner abstraction beyond what BullMQ already provides, per CLAUDE.md §15's "one dependency per need."

## 9. Caching

Two read-only, rarely-changing datasets get HTTP caching, nothing else:
- `GET /codelists` → `Cache-Control: max-age=3600` (REQ-CODELIST-001) — code lists only change on redeploy/reseed
- `GET /rules` and `GET /config` are small enough (and change rarely enough, gated by an explicit version bump — REQ-RULES-001) that no server-side cache is needed beyond the client's own versioned-refresh logic (REQ-SYNC "refresh caches if versions changed" in the frontend SyncEngine)

No Redis-backed application cache is introduced — Redis in this system is BullMQ's queue store and the PIN-lockout counter's store (REQ-AUTH-006), not a general cache layer. Adding one without a requirement behind it would violate CLAUDE.md §15.

## 10. How the frontend's auth flow maps onto the backend

| Frontend screen/state | Backend call | Notes |
|---|---|---|
| S01 Splash — silent refresh if <1h left | `POST /auth/refresh` | REQ-AUTH-015 |
| S02 Phone entry | `POST /auth/otp/request` | REQ-AUTH-002 |
| S03 OTP entry | `POST /auth/otp/verify` → `tempToken` | REQ-AUTH-004 |
| S04 PIN unlock (existing user, online) | `POST /auth/pin/login` | REQ-AUTH-006 |
| S04 PIN unlock (offline) | *no call* — local argon2/PBKDF2 check opens the SQLCipher DB | REQ-AUTH-014/016 |
| S04 "Forgot PIN" → re-verify OTP → set new PIN | `POST /auth/otp/verify` then `POST /auth/pin/set` (re-used per OPEN_QUESTIONS Q2) | REQ-AUTH-005 |
| S05 Set PIN + name (first time) | `POST /auth/pin/set` (Bearer tempToken) | REQ-AUTH-005 |
| S18 Provider activation | `POST /auth/provider/activate` | REQ-AUTH-008 |
| Every subsequent authenticated call | `Authorization: Bearer <accessToken>`; on 401, one silent `POST /auth/refresh` then retry, else force logout to S04 | REQ-AUTH-007/012, frontend.md §8 AuthInterceptor |

The access token is a stateless JWT (12 h) — the backend never needs a session store to validate it, only to revoke refresh tokens (REQ-AUTH-011) and check the PIN-lockout counter (REQ-AUTH-006), both in Redis/Postgres respectively. This means horizontal scaling of the API process requires no sticky sessions — any instance can validate any access token.

## 11. Justification check

Every module, plugin, queue, and cross-cutting concern listed above traces to at least one REQ ID above. Nothing in this document introduces a component without one — in particular, there is **no** repository layer beyond services (see §1), **no** generic cache layer (see §9), and **no** admin/dashboard module (Tier 2/3, out of scope per REQUIREMENTS.md AS4).
