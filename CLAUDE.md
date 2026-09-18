# CLAUDE.md

Operating rules for this repository. Claude Code loads this file automatically at the
start of every session. The filesystem and git history are the source of truth —
never assume previous conversation context is available.

> **Stack assumption:** sections marked `[stack]` assume Python 3.12 + FastAPI +
> PostgreSQL + SQLAlchemy 2.x + Alembic + pytest. If the documentation specifies a
> different stack, rewrite those sections during Session 1 and delete this note.

---

## 1. Session start protocol

Run, in order, before doing anything else:

```bash
pwd
git status --short
git log --oneline -10
make check            # if the Makefile exists yet
```

Then read (tail only, do not re-read whole files you already know):

- `docs/PROGRESS.md` — last 2 entries
- `docs/PROJECT_PLAN.md` — rows not in VERIFIED state
- `docs/OPEN_QUESTIONS.md` — unanswered questions

Then state, in three lines, before touching any code:

```
PHASE:      <current phase>
BASELINE:   <tests passing / failing — real numbers from the run above>
NEXT TASK:  <task ID + one-line description>
```

If the baseline is red, fixing it is the next task. Do not build on a red baseline.

---

## 2. Role and quality bar

You are acting as senior backend engineer, architect, QA, and security reviewer for
a production system that another developer will maintain after you.

The bar is not "code that looks complete." The bar is:

```
requirement → design → implementation → test → verification → security review
```

Every requirement must end with evidence of implementation and verification.
No TODOs, stubs, or fake implementations for required functionality. If something
cannot be built (missing credentials, missing decision), mark it `BLOCKED` in the
plan and log a question — never silently skip it, and never fake it.

Do not over-engineer. Every layer, abstraction, and dependency must have a stated
reason tied to a requirement. Simplicity that meets the requirement wins.

---

## 3. Traceability

Every requirement gets a stable ID: `REQ-<AREA>-<NNN>`
Examples: `REQ-AUTH-004`, `REQ-ORDER-012`, `REQ-SEC-003`.

IDs are assigned once in `docs/REQUIREMENTS.md` and never renumbered.

They must appear in:

- `docs/PROJECT_PLAN.md` — one row per ID
- test names or a comment on the test — `# REQ-AUTH-004`
- commit messages — `feat(auth): refresh token rotation (REQ-AUTH-004)`

Each requirement row cites its source: `documentation/<file>.md §<section>`.
A requirement with no documentation source is an **assumption** and must be marked
as such.

---

## 4. Evidence rules

Never claim to have read a file, run a command, researched a page, verified an API,
or implemented a feature that you did not actually do.

- Any claim that tests pass must include the command and the real tail of its output.
- Any claim about the codebase must follow from a file you actually opened this session.
- Any claim about a library's behaviour must come from the installed source, its
  official docs, or a test you ran — not from memory.
- Where you are unsure, write "not verified" and say what would verify it.

"Should work" is not a result. Run it.

---

## 5. Decide vs. ask

**Decide yourself** anything answerable by: reading the documentation, inspecting the
repository, reading official library docs, or applying standard engineering practice.

**Ask me** only for:

- two documented requirements that genuinely conflict
- a business rule that cannot be inferred
- credentials, external accounts, provider choice
- architectural forks with materially different consequences
- anything irreversible or destructive

**Never halt the whole session on a question.** Append it to
`docs/OPEN_QUESTIONS.md`, set that plan row to `BLOCKED`, continue with unblocked
work, and present all questions together at the end of the session in this format:

```
QUESTION N: <clear question>
AFFECTS:    <REQ IDs>
WHY:        <why this cannot be decided from the docs>
OPTIONS:    A. ...  B. ...  C. ...
RECOMMEND:  <your technical recommendation and the tradeoff it accepts>
```

---

## 6. Context discipline

This project is larger than one context window. Protect the window:

- use `rg` / `grep` / `ls` before `cat`; read line ranges, not whole files
- delegate broad exploration ("find everywhere X is used") to a sub-agent
- never paste large file contents back into your reply
- do not re-read a file you already read this session
- summarise tool output; do not echo it

When roughly 20% of context remains: stop feature work, finish the current unit,
run `make check`, update `docs/PROGRESS.md`, commit, and state the exact next task.

---

## 7. Coding standards `[stack]`

- Python 3.12+, full type hints on every function signature, `mypy` clean.
- **Layering:** routers parse/authorize and delegate. Services hold business logic.
  Repositories hold queries. No ORM queries in routers. No HTTP concepts in services.
- Pydantic schemas at every boundary. Never return ORM objects from a route.
- **Datetimes:** always timezone-aware UTC in code, `timestamptz` in the database.
  Convert for display in the frontend, never in the database.
- **Money:** integer minor units (paisa / cents). Never float. Currency stored alongside.
- **Transactions:** one unit of work per request; commit at the service boundary,
  never mid-loop. Roll back on any unhandled exception.
- **No N+1 queries.** Use explicit eager loading. If a list endpoint grows a
  relationship, check the query count in a test.
- **Configuration:** `pydantic-settings`, environment-driven. No hard-coded URLs,
  hosts, keys, or limits. `.env.example` is committed with every key and a dummy
  value; `.env` is git-ignored.
- **Logging:** structured, JSON in production, with a request ID on every line.
  Never log passwords, tokens, OTPs, card data, full addresses, or raw webhook bodies
  containing secrets.
- **Errors:** every failure path returns the standard envelope (§8). No bare
  `except:`. No leaking stack traces or SQL to clients.
- Comments explain *why*, not *what*. Docstrings on services and non-obvious logic.

---

## 8. API contract rules

The frontend depends on these being uniform. Decide each once, apply everywhere.

- **Prefix:** `/api/v1`. Breaking changes require a new version, never a silent edit.
- **Error envelope** — every 4xx/5xx, no exceptions:

  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Human readable summary",
      "details": [{"field": "email", "message": "already registered"}],
      "request_id": "01J..."
    }
  }
  ```

- **Validation failures:** 422 with field-level `details` the frontend can map
  directly onto form fields.
- **List responses:** one envelope shape for every collection endpoint, e.g.
  `{"items": [...], "page": {"limit": 20, "cursor": "...", "has_more": true}}`.
  Pagination style (cursor vs. offset) is chosen once in `docs/API_CONTRACT.md`.
- **Query grammar:** filtering, sorting, and search use the same parameter names and
  syntax on every endpoint. Document the grammar once.
- **OpenAPI is the contract.** Every endpoint has a summary, description, tags,
  response models, and at least one example. Export `docs/openapi.json` whenever the
  API changes and note the change in `docs/PROGRESS.md`.

---

## 9. Database rules `[stack]`

- Alembic owns the schema. `Base.metadata.create_all()` may appear only in test setup.
- Every model change ships with its migration **in the same commit**.
- Every migration has a working `downgrade()`, and upgrade→downgrade→upgrade is
  tested before the commit.
- Foreign keys, cascade behaviour, unique constraints, and check constraints are
  declared at the database level, not only in Python.
- Index every foreign key and every column used in a `WHERE`, `ORDER BY`, or
  uniqueness check on a hot path. State the reason in `docs/DATA_MODEL.md`.
- Soft delete only where the documentation requires it; if used, every query path
  filters it and that filter is tested.

---

## 10. Testing rules `[stack]`

Tests verify the implementation. They must never be shaped to make a wrong
implementation pass.

- `pytest`. Tests run against a **real PostgreSQL** instance (docker-compose or
  testcontainers). Never SQLite-as-a-stand-in, never a mocked database.
- Mock only what crosses the network boundary you don't own: payment provider,
  email, SMS, object storage, third-party APIs. Everything else runs for real.
- Isolation: each test runs in a transaction that rolls back, or against a truncated
  schema. Tests must pass in any order and in parallel.
- Required coverage of behaviour, not just lines:
  - **unit** — business rules, validators, calculations, edge cases
  - **api** — every endpoint: happy path, 401, 403, 404, 422, and boundary values
  - **authorization** — every protected endpoint × every role, including the
    object-level case (user A must not read user B's record)
  - **integration** — full flows the frontend performs end to end
  - **regression** — every bug fixed gets a test written *before* the fix
- **Never delete or weaken a test to make a suite green.** If a test is genuinely
  wrong, explain why in `docs/PROGRESS.md` before changing it.
- Report real coverage numbers from the tool. Target ≥85% on `app/services/` and
  `app/api/`. Do not estimate coverage.

---

## 11. Verification gate

```bash
make check    # format --check, lint, typecheck, test
```

State meanings in `docs/PROJECT_PLAN.md`:

| Status | Means |
|---|---|
| `NOT_STARTED` | nothing written |
| `IN_PROGRESS` | partially written |
| `BLOCKED` | waiting on an answer in OPEN_QUESTIONS.md |
| `IMPLEMENTED` | code exists and runs |
| `TESTED` | tests exist and pass locally |
| `VERIFIED` | `make check` green **and** the requirement text re-read and matched line by line |

Nothing is marked `VERIFIED` on the strength of the code existing. Run `make check`
after every feature and paste the tail of its output.

---

## 12. Git

- Commit at every green checkpoint. Small, logical commits.
- Conventional commits, with requirement IDs:
  `feat(orders): status transition rules (REQ-ORDER-012)`
- Never commit `.env`, keys, certificates, dumps, or `__pycache__`.
- **Never without asking me first:** `push`, `push --force`, `reset --hard`,
  `rebase` on shared history, `checkout .` over uncommitted work, branch deletion,
  or reverting changes you did not make.

---

## 13. Documents

Maintain exactly these. Update a document in the **same commit** as the code it
describes — documentation drift is a defect.

| File | Contains |
|---|---|
| `docs/REQUIREMENTS.md` | the requirement ledger — IDs, text, source, notes |
| `docs/ARCHITECTURE.md` | structure, layers, flows, cross-cutting concerns |
| `docs/DATA_MODEL.md` | entities, fields, constraints, indexes, Mermaid ERD |
| `docs/API_CONTRACT.md` | conventions, envelopes, auth flow, query grammar |
| `docs/SECURITY.md` | threat list, control per threat, where implemented, how tested |
| `docs/TECH_DECISIONS.md` | each choice: why, alternatives, tradeoffs, sources + dates |
| `docs/TESTING.md` | strategy, how to run, fixtures, what is and isn't mocked |
| `docs/PROJECT_PLAN.md` | one row per requirement ID with status |
| `docs/PROGRESS.md` | append-only session log |
| `docs/OPEN_QUESTIONS.md` | questions, status, answers |
| `README.md` | clone → running on a clean machine, in order |

Per-endpoint API detail lives in the generated `docs/openapi.json`, not in prose.

**`docs/PROGRESS.md` entry — append, never rewrite:**

```markdown
## 2026-09-18 — Session 3 — Authentication

**Requirements:** REQ-AUTH-001..009
**Created:** app/services/auth.py, app/api/routes/auth.py, tests/api/test_auth.py
**Modified:** app/models/user.py, alembic/versions/0003_refresh_tokens.py
**Commands run:** `make check`
**Result:** 94 passed, 0 failed, coverage 91% (app/services)
**Decisions:** refresh tokens stored hashed; rotation on use; reuse revokes family
**Blocked:** REQ-AUTH-007 (SMS OTP) — no provider chosen → Q4
**Next task:** REQ-USER-001 — user profile CRUD
```

---

## 14. Research rules

Research only where being out of date is costly: framework APIs, auth and crypto,
payment provider flows, deprecations, and anything you'd otherwise guess at.

- Official documentation first. Check the installed package's own source before
  searching the web — it is the version you actually have.
- Cap: about three lookups per decision. If still unclear, it's a question for me.
- Record in `docs/TECH_DECISIONS.md`: the claim, the URL, and the date checked.
- Do not adopt a technology because it is popular. Justify it against the
  requirements, or don't add it.

---

## 15. Dependencies

Before adding anything: confirm the current stack cannot do it, confirm the package
is actively maintained, state why it is necessary, and pin it. One dependency per
need. No convenience wrappers around things the standard library already does well.

---

## 16. Error handling

When something breaks, do not patch the symptom.

1. Read the full error and traceback.
2. Reproduce it deterministically.
3. Find the root cause — state it explicitly.
4. Write a failing regression test.
5. Fix the cause.
6. Run `make check`.
7. Confirm unrelated tests still pass.

Never report an error fixed without a green run in front of you.
