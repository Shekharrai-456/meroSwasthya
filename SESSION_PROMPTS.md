# Session prompts for Claude Code

`CLAUDE.md` carries every persistent rule and is loaded automatically. These prompts
carry only the goal of one session. Paste one per session. Do not paste `CLAUDE.md`.

**Setup, once:**

```bash
cp CLAUDE.md /path/to/repo/CLAUDE.md
cd /path/to/repo
git checkout -b backend-build
claude
```

**Session map.** Seven sessions, one of them repeated. Three is not realistic for a
production backend; attempting it produces a shallow version of everything.

| # | Session | Ends when |
|---|---|---|
| 0 | Recon & requirement ledger | REQUIREMENTS.md + OPEN_QUESTIONS.md exist, no code |
| 1 | Design | design docs + PROJECT_PLAN.md exist, no app code |
| 2 | Foundation & test harness | `make check` green on an empty app |
| 3 | Auth, RBAC, users | auth flows fully tested |
| 4 | One business module — **repeat per module** | module VERIFIED |
| 5 | Cross-cutting: files, notifications, payments, jobs | each VERIFIED or BLOCKED |
| 6 | Hardening & production readiness | FINAL_AUDIT.md complete |

Between sessions: read the questions, answer them in `docs/OPEN_QUESTIONS.md`, and
start the next session.

---

## SESSION 0 — Recon and requirement ledger

```
Session 0: reconnaissance and requirements. Read CLAUDE.md first.

Write no application code this session. None. The only files you create are the
two documents named below.

1. Establish ground truth.
   - pwd, full directory tree (ignore node_modules/.venv/.git), git status, git log.
   - Classify this repo: empty / frontend only / partial backend / mixed. State it
     explicitly and cite the evidence.
   - If existing code is present, summarise what it does before proposing anything.
     Do not plan to overwrite work you have not read.

2. Read the documentation folder in full — every file, frontend and backend. Do not
   stop at the file that looks most relevant. List each file you read with a
   one-line summary so I can see nothing was skipped.

3. Build docs/REQUIREMENTS.md — the requirement ledger. One row per requirement:

   | ID | Requirement | Source | Type | Depends on | Risk | Notes |

   - ID format REQ-<AREA>-<NNN>, assigned once, never renumbered.
   - Source is file + section. A requirement with no source is an ASSUMPTION and
     labelled as such.
   - Cover: roles, permissions, auth, every entity implied by the workflows, every
     endpoint the frontend needs, business rules, validation rules, file uploads,
     search/filter/sort/pagination, notifications, payments, integrations,
     analytics, and every non-functional requirement.
   - Derive requirements from the FRONTEND docs too. Every screen, form, table,
     and state the frontend describes implies data and endpoints. Trace them.

4. Add sections at the end of REQUIREMENTS.md:
   - CONTRADICTIONS — requirements that conflict, with both citations
   - AMBIGUITIES — genuinely unclear, after checking the surrounding docs
   - GAPS — the frontend needs it but the backend docs never mention it
   - ASSUMPTIONS — what you inferred, and what breaks if the inference is wrong

5. Create docs/OPEN_QUESTIONS.md with only the questions that truly need me,
   in the CLAUDE.md question format, ordered by how much they block.

Do not choose a tech stack, design a schema, or propose an architecture this
session. Finish with: repo classification, docs read, requirement count by area,
the contradictions and gaps, and your questions.
```

---

## SESSION 1 — Design

```
Session 1: design. Read CLAUDE.md, then docs/REQUIREMENTS.md and
docs/OPEN_QUESTIONS.md (my answers are in there now).

Still no application code. Design documents only.

1. docs/TECH_DECISIONS.md — every major choice: framework, DB, ORM, migrations,
   validation, auth library, task queue, cache, storage, email, payments, testing.
   For each: what it is, why this project needs it, why this option, alternatives
   rejected and why, tradeoffs, security notes, maintenance outlook, and the
   official source URL with the date you checked it. Verify anything version-
   sensitive against current official docs — do not rely on memory or tutorials.
   If the requirements do not need a component, say so and leave it out.

2. docs/ARCHITECTURE.md — layers and their boundaries, the final directory tree,
   request lifecycle, where validation happens, error handling strategy, logging,
   configuration, transactions, background work, caching, and how the frontend's
   auth flow maps onto the backend. Every component justified by a REQ ID. Delete
   anything you cannot justify that way.

3. docs/DATA_MODEL.md — full schema: entities, fields, types, PK/FK, unique and
   check constraints, indexes with reasons, relationships, cascade behaviour,
   soft-delete policy, timestamps, audit fields, enums. A Mermaid ERD. Then a
   coverage table mapping each entity to the REQ IDs it serves. Any table serving
   zero requirements gets deleted.

4. docs/API_CONTRACT.md — the conventions, not per-endpoint prose (OpenAPI covers
   that later): versioning, auth header and token lifetimes, the error envelope,
   the validation-error shape, the list envelope and pagination style (choose
   cursor or offset and justify it), the filter/sort/search parameter grammar,
   status code policy, idempotency policy, rate limit headers, upload flow.
   Then a table of every planned endpoint: method, path, auth, role, REQ ID.
   Cross-check that table against the frontend docs and list any endpoint the
   frontend implies that is missing — and any endpoint with no frontend consumer.

5. docs/SECURITY.md — a threat table, not a checklist. Per row: threat, where this
   app is exposed, the control, where it will live in the code, how it will be
   tested. Cover password storage, token design and rotation, session
   invalidation, RBAC, object-level authorization, injection, CORS, rate limiting,
   brute force, secure headers, secrets, upload validation (MIME, magic bytes,
   size, path traversal, stored filename), sensitive data in logs, webhook
   signature verification and replay, and payment handling. "We use library X" is
   not a control — name the implementation.

6. docs/PROJECT_PLAN.md — one row per REQ ID: ID, requirement, phase, status,
   code location (planned), test location (planned), notes. All NOT_STARTED.
   Order the phases by real dependency, not by the template order.

7. docs/PROGRESS.md — first entry, per the CLAUDE.md template.

Finish with: the architecture in ten sentences, the stack table, the schema
summary, the frontend/backend conflicts you found, and any new questions.
Do not start Session 2 until I approve.
```

---

## SESSION 2 — Foundation and test harness

```
Session 2: foundation. Read CLAUDE.md, then PROGRESS.md, PROJECT_PLAN.md,
ARCHITECTURE.md, TECH_DECISIONS.md.

Goal: a running, empty, fully verified skeleton. No business features yet. The
session succeeds when `make check` is green and `docker compose up` gives me a
working API with docs, from a clean clone.

Build, in this order, committing at each green step:

1. Project skeleton exactly as ARCHITECTURE.md specifies. Dependency manifest with
   pinned versions. Formatter, linter, and type checker configured with real
   settings, not defaults.
2. Makefile: `make install`, `make up`, `make down`, `make migrate`, `make test`,
   `make check`, `make seed`. `make check` runs format-check, lint, typecheck,
   and tests, and fails on any of them.
3. Configuration: typed settings from environment, validated at startup, failing
   loudly on a missing required key. Commit .env.example with every key present
   and dummy values. Confirm .env is git-ignored.
4. docker-compose for app + PostgreSQL + anything else the design requires, with
   a separate database for tests.
5. Database wiring, session lifecycle, Alembic initialised, one empty baseline
   migration, upgrade and downgrade both verified by running them.
6. Cross-cutting middleware: request ID generation and propagation, structured
   logging, the global exception handler producing the CLAUDE.md error envelope
   for every error class including validation and unhandled exceptions, and CORS
   driven by configuration.
7. Health endpoints: liveness, and readiness that actually checks the database.
8. Test harness: pytest configured against real PostgreSQL, per-test isolation,
   an authenticated-client fixture placeholder, factory fixtures, coverage
   reporting. Then write tests that prove the harness works — health endpoints,
   the error envelope shape for 404/422/500, request ID propagation, config
   validation failure, and migration up/down.
9. CI: one workflow running `make check` on push.
10. README: clone to running, in order, on a clean machine. Follow your own
    instructions literally and fix whatever doesn't work.

Run `make check`. Paste the real output tail. Update PROJECT_PLAN.md and
PROGRESS.md. Tell me the exact next task.
```

---

## SESSION 3 — Authentication, authorization, users

```
Session 3: auth, RBAC, and user management. Read CLAUDE.md, then PROGRESS.md,
PROJECT_PLAN.md, SECURITY.md, API_CONTRACT.md, and the auth-related rows of
REQUIREMENTS.md.

This is the highest-risk area in the project. Depth over speed.

Implement every REQ-AUTH-*, REQ-ROLE-*, and REQ-USER-* row:

- User model and migration, per DATA_MODEL.md.
- Password hashing per SECURITY.md, with the cost parameter in configuration.
- Registration, login, logout, refresh, password change, password reset, plus
  email verification if the docs require it.
- Token design exactly as SECURITY.md specifies: access and refresh lifetimes,
  claims, rotation, revocation, and server-side invalidation. Refresh tokens
  stored hashed. Reuse of a rotated token invalidates the family.
- RBAC: roles and permissions as data where the docs imply they change, as enums
  where they don't. A reusable dependency for role checks, and a separate,
  explicit mechanism for object-level ownership checks. These are different
  problems — do not conflate them.
- User CRUD, profile, admin user management, and whatever listing the frontend
  documentation describes.
- Rate limiting and brute-force protection on the auth endpoints.

Testing — this section is not optional and not a sample:

- Every endpoint: success, wrong password, unknown user, inactive/unverified user,
  expired token, malformed token, missing token, wrong token type, revoked token,
  reused refresh token, and every validation failure.
- A matrix test: every protected endpoint × every role × allowed/denied, generated
  from a table so adding a role or endpoint is one line.
- Object-level: user A cannot read, update, or delete user B's resources — assert
  the status code is the one SECURITY.md specifies, consistently.
- Password reset tokens: single use, expiring, and not guessable.
- Assert that no response body and no log line contains a password hash or a token.

Then verify against the frontend documentation: does the login response contain
exactly the fields the frontend expects, is the token delivery mechanism the one
the frontend assumes, do the error codes match what the UI branches on? Report any
mismatch rather than quietly choosing one side.

Run `make check`. Paste the output. Export docs/openapi.json. Update the plan and
PROGRESS.md.
```

---

## SESSION 4 — Business module (repeat once per module)

```
Session 4-<N>: implement the <MODULE NAME> module. Read CLAUDE.md, then
PROGRESS.md, PROJECT_PLAN.md, and the REQ rows for this module only.

Scope is exactly the requirement IDs for this module: <REQ-XXX-001..NNN>.
Do not start a second module in this session. Do not refactor unrelated code.

1. Re-read those requirement rows and their documentation sources. State the
   business rules in your own words first and flag anything you had to interpret.
2. Models + migration. Run upgrade and downgrade.
3. Repository layer: queries only, eager-loading declared, no business logic.
4. Service layer: every business rule, every state transition, every invariant.
   Invalid transitions raise domain errors — they are not merely undocumented.
5. Schemas: separate create, update, and response shapes. Response shapes match
   what the frontend documentation actually renders.
6. Routes: thin. Authorization declared per route. Pagination, filtering, sorting,
   and search follow the API_CONTRACT grammar exactly — no per-module variations.
7. OpenAPI: summary, description, response models, and one realistic example per
   endpoint.

Tests:
- unit tests for every business rule and every state transition, valid and invalid
- API tests for every endpoint including 401, 403, 404, 422 and boundary values
- authorization tests per role, plus the cross-user object-level case
- pagination edge cases: empty, exactly one page, past the end, bad cursor
- a query-count assertion on the list endpoint to catch N+1
- an integration test of the full flow as the frontend would perform it

Run `make check`, paste the output, export docs/openapi.json, update the plan rows
to VERIFIED only if the requirement text was re-read and matched, and write the
PROGRESS entry naming the next module.
```

---

## SESSION 5 — Cross-cutting: files, notifications, payments, jobs

```
Session 5: cross-cutting features. Read CLAUDE.md, PROGRESS.md, PROJECT_PLAN.md,
SECURITY.md, and the relevant REQ rows.

Take these in order and finish each before starting the next. Any part lacking
credentials becomes BLOCKED with a question — build the real integration behind a
clean interface, never a fake that pretends to work.

1. File uploads (REQ-FILE-*): size limits, MIME and magic-byte validation,
   extension allowlist, stored filenames generated server-side, originals never
   used as paths, path traversal blocked, storage backend per TECH_DECISIONS,
   access control on retrieval, cleanup of orphans. Test the attacks, not just
   the happy path: oversized, wrong type, content/extension mismatch, traversal
   in the filename, and another user fetching the file.

2. Notifications (REQ-NOTIF-*): the channels the docs require, templates, a
   provider interface with a real implementation plus a test double used only in
   tests, delivery records if the frontend displays them, user preferences and
   opt-out if documented. Rendering and triggering are tested; network is mocked.

3. Background jobs (REQ-JOB-*): queue per TECH_DECISIONS, retries with backoff,
   idempotent handlers, failure visibility, scheduled jobs if required. Test that
   a handler run twice produces one effect.

4. Payments (REQ-PAY-*) — treat as security-critical:
   - Verify the provider's current official integration flow before writing code;
     record the URL and date in TECH_DECISIONS.md.
   - Amounts computed server-side from server-held prices. A client-supplied
     amount is never trusted.
   - Idempotency keys on initiation. Duplicate submits create one payment.
   - Webhooks: signature verified before parsing, replay rejected, handler
     idempotent, unknown events logged and ignored, responses fast.
   - A payment state machine with explicit legal transitions and an audit trail.
   - Refunds and failures if documented.
   - Tests against recorded provider payloads: valid webhook, tampered signature,
     replayed event, out-of-order events, amount mismatch, duplicate initiation.
   - Never use live credentials. Sandbox only, and ask before any real call.

5. Search, filtering, analytics and dashboard endpoints (REQ-*): implement what
   the frontend dashboards actually display, with indexes to support them.

Run `make check` after each part. Paste output. Update plan and PROGRESS.
```

---

## SESSION 6 — Hardening, audit, production readiness

```
Session 6: hardening and final audit. Read CLAUDE.md and every document in docs/.

1. Security review by reading the code, not by trusting the library list. Walk
   SECURITY.md row by row and, for each control, open the file where it lives and
   confirm it is actually applied on every path — not just the one you remember.
   Specifically verify: every endpoint has an explicit auth decision; no endpoint
   is unintentionally public; object-level checks exist wherever an ID comes from
   the client; secure headers are set; CORS is not permissive; rate limits are
   applied where SECURITY.md says; no secret, token, or PII appears in any log
   line or error response; upload and webhook validation cannot be bypassed.
   Write findings with severity and fix them, highest first, each with a test.

2. Frontend contract verification. Walk the frontend documentation screen by
   screen. For each screen list the endpoints it calls and confirm each exists,
   returns the fields it needs, in the shape it expects, with the error codes it
   branches on. Report every mismatch and resolve it explicitly.

3. Performance pass: query counts on list endpoints, missing indexes against the
   real query patterns, pagination limits capped, response sizes sane. Measure
   before claiming anything.

4. Production readiness: graceful shutdown, connection pool sizing, timeouts on
   every outbound call, readiness vs liveness correctness, log levels, migration
   procedure documented, rollback procedure documented, required environment
   variables documented, and a deployment section in the README.

5. Full run: `make check` from a clean clone following only the README. Fix what
   fails in the README, not just in your shell.

6. docs/FINAL_AUDIT.md — every requirement ID with: requirement, implementation
   file(s), test file(s), verification status, evidence, notes. Anything not
   VERIFIED is listed at the top with the reason. Do not mark VERIFIED without
   having actually run the test that covers it.

Finish with: the audit summary by area, remaining gaps and blockers, the security
findings and their resolutions, and what you would fix next with more time.
```

---

## Resume prompt — for any interrupted session

```
Resume. Read CLAUDE.md, run the session start protocol, and report PHASE /
BASELINE / NEXT TASK before doing anything else. Then continue from the next
unfinished task in PROJECT_PLAN.md. Do not restart completed work and do not
re-plan finished phases.
```

## Mid-session correction prompt

```
Stop. Before continuing: you claimed <X>. Show me the command you ran and its
output, or the file and line numbers that support it. If you cannot, say so
plainly and re-verify.
```
